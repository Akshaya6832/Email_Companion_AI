import os
import time
import base64
import datetime
from datetime import timezone
import logging
import threading
import email.utils
import traceback
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from ollama import Client as OllamaClient

# === CONFIG ===
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']
CHECK_INTERVAL = 20  # seconds
OLLAMA_MODEL = "llama3"
ACCOUNTS_FILE = "accounts.txt"

# === LOGGING ===
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# === LOAD ACCOUNTS DYNAMICALLY ===
def load_accounts():
    if not os.path.exists(ACCOUNTS_FILE):
        logging.error(f"⚠️ Accounts file '{ACCOUNTS_FILE}' not found. Please create it with one account name per line.")
        exit(1)
    with open(ACCOUNTS_FILE, 'r') as f:
        return [line.strip() for line in f if line.strip()]

# === AUTHENTICATE AND SAVE TOKEN ===
def authenticate_gmail(account_label):
    logging.info(f"\n🔐 Authenticating account: {account_label}")
    creds = None
    token_path = f'tokens/{account_label}_token.json'

    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    if not creds or not creds.valid:
        flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
        creds = flow.run_local_server(port=0)
        os.makedirs('tokens', exist_ok=True)
        with open(token_path, 'w') as token:
            token.write(creds.to_json())

    service = build('gmail', 'v1', credentials=creds)
    profile = service.users().getProfile(userId='me').execute()
    user_email = profile['emailAddress']
    user_name = user_email.split('@')[0].capitalize()
    logging.info(f"✅ Logged in as: {user_email} ({user_name})")
    return service, user_email, user_name

# === TONE DETECTION ===
def detect_tone(snippet):
    snippet_lower = snippet.lower()
    friendly_keywords = ['friend', 'miss you', 'love', 'enjoyed', 'tour', 'excited', 'fun']
    return 'friendly' if any(word in snippet_lower for word in friendly_keywords) else 'formal'

# === AI REPLY GENERATOR ===
def generate_ai_reply(client, subject, snippet, user_name, tone, sender_name):
    prompt = f"""You are a helpful and professional email assistant.

Write a complete reply to the following email in a {tone} tone.

Start the email with:
Dear {sender_name},

Do NOT include any introductions like "Here's your reply" or "As requested".

End the message with:
Best regards,
{user_name}

Email to reply to:
\"\"\"
{snippet}
\"\"\"
"""
    response = client.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
    return response['message']['content'].strip()

# === SUBJECT GENERATOR ===
def generate_reply_subject(original_subject):
    if not original_subject:
        return "Re: Your Email"
    return original_subject if original_subject.lower().startswith("re:") else f"Re: {original_subject}"

# === CREATE DRAFT IN GMAIL ===
def create_draft(service, thread_id, to, subject, body):
    message = MIMEMultipart()
    message['to'] = to
    message['subject'] = subject
    message.attach(MIMEText(body, 'plain'))

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    draft = {'message': {'raw': raw, 'threadId': thread_id}}
    return service.users().drafts().create(userId='me', body=draft).execute()

# === MARK EMAIL AS READ ===
def mark_as_read(service, msg_id):
    service.users().messages().modify(
        userId='me',
        id=msg_id,
        body={'removeLabelIds': ['UNREAD']}
    ).execute()

# === FETCH NEW EMAILS ===
def fetch_new_emails(service, install_time):
    response = service.users().messages().list(userId='me', labelIds=['INBOX', 'UNREAD'], maxResults=10).execute()
    messages = response.get('messages', [])
    new_messages = []

    for msg in messages:
        message = service.users().messages().get(userId='me', id=msg['id']).execute()
        internal_date = int(message.get('internalDate', 0)) / 1000.0
        if internal_date > install_time.timestamp():
            new_messages.append(message)
    return new_messages

# === PER-ACCOUNT HANDLER THREAD ===
def run_account(account_label):
    service, user_email, user_name = authenticate_gmail(account_label)
    ollama = OllamaClient()
    install_time = datetime.datetime.now(timezone.utc)
    DAILY_MAIL_COUNT = {}

    while True:
        try:
            start = time.time()
            messages = fetch_new_emails(service, install_time)

            if not messages:
                logging.info(f"📭 [{user_email}] No new emails found.")

            today = datetime.date.today().isoformat()
            if today not in DAILY_MAIL_COUNT:
                DAILY_MAIL_COUNT[today] = 0

            for message in messages:
                headers = message['payload'].get('headers', [])
                subject = next((h['value'] for h in headers if h['name'].lower() == 'subject'), '')
                sender_full = next((h['value'] for h in headers if h['name'].lower() == 'from'), '')
                sender_name, sender_email = email.utils.parseaddr(sender_full)
                if not sender_name:
                    sender_name = sender_email.split('@')[0].capitalize()

                snippet = message.get('snippet', '')
                tone = detect_tone(snippet)

                logging.info(f"\n📩 [{user_email}] New Email from {sender_name} <{sender_email}> | Subject: {subject}")
                logging.info(f"Snippet: {snippet}")

                ai_reply = generate_ai_reply(ollama, subject, snippet, user_name, tone, sender_name)
                reply_subject = generate_reply_subject(subject)

                create_draft(service, message['threadId'], sender_email, reply_subject, ai_reply)
                mark_as_read(service, message['id'])

                DAILY_MAIL_COUNT[today] += 1
                logging.info(f"✅ [{user_email}] Draft created for message ID {message['id']} (Count today: {DAILY_MAIL_COUNT[today]})")

            end = time.time()
            logging.info(f"🔄 [{user_email}] Check completed in {round(end - start, 2)}s. Waiting {CHECK_INTERVAL}s...\n")
            time.sleep(CHECK_INTERVAL)

        except Exception as e:
            logging.error(f"❌ [{account_label}] Error occurred:")
            logging.error(traceback.format_exc())
            time.sleep(CHECK_INTERVAL)

# === MAIN EXECUTION ===
def main():
    os.makedirs("tokens", exist_ok=True)
    accounts = load_accounts()
    if not accounts:
        logging.error("❌ No accounts found in accounts.txt.")
        return

    threads = []
    for account_label in accounts:
        t = threading.Thread(target=run_account, args=(account_label,), daemon=True)
        t.start()
        threads.append(t)

    for t in threads:
        t.join()

if __name__ == '__main__':
    main()
