// GARA - Gmail AI Reply Assistant
// Main JavaScript functionality

// Initialize notification system first
function initializeNotifications() {
    // Show success/error notifications
    function showNotification(message, type = 'info') {
        const notificationHtml = `
            <div class="alert alert-${type} alert-dismissible fade show notification-toast" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
        
        const container = document.getElementById('notifications') || createNotificationContainer();
        container.insertAdjacentHTML('beforeend', notificationHtml);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            const notification = container.querySelector('.notification-toast:last-child');
            if (notification) {
                notification.remove();
            }
        }, 5000);
    }
    
    function createNotificationContainer() {
        const container = document.createElement('div');
        container.id = 'notifications';
        container.className = 'position-fixed top-0 end-0 p-3';
        container.style.zIndex = '1050';
        document.body.appendChild(container);
        return container;
    }
    
    // Expose notification function globally
    window.showNotification = showNotification;
}

// Call this immediately
initializeNotifications();

document.addEventListener('DOMContentLoaded', function() {
    // Initialize tooltips
    initializeTooltips();
    
    // Initialize auto-refresh for dashboard
    initializeAutoRefresh();
    
    // Initialize form validation
    initializeFormValidation();
});

// Initialize Bootstrap tooltips
function initializeTooltips() {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function(tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
}

// Auto-refresh functionality for dashboard
function initializeAutoRefresh() {
    // Only run on dashboard page
    if (!document.querySelector('.dashboard-page') && !window.location.pathname.includes('dashboard')) {
        return;
    }
    
    let refreshInterval;
    
    // Check for active syncing
    function checkSyncStatus() {
        fetch('/api/sync_status')
            .then(response => response.json())
            .then(data => {
                updateSyncStatus(data);
            })
            .catch(error => {
                console.error('Error checking sync status:', error);
            });
    }
    
    // Update sync status indicators
    function updateSyncStatus(accounts) {
        accounts.forEach(account => {
            const statusElement = document.querySelector(`[data-account-id="${account.id}"]`);
            if (statusElement) {
                const lastSyncElement = statusElement.querySelector('.last-sync');
                if (lastSyncElement && account.last_sync) {
                    const syncDate = new Date(account.last_sync);
                    lastSyncElement.textContent = `Last sync: ${syncDate.toLocaleString()}`;
                }
            }
        });
    }
    
    // Start auto-refresh every 30 seconds
    refreshInterval = setInterval(checkSyncStatus, 30000);
    
    // Stop auto-refresh when page is hidden
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            clearInterval(refreshInterval);
        } else {
            refreshInterval = setInterval(checkSyncStatus, 30000);
        }
    });
}



// Form validation
function initializeFormValidation() {
    const forms = document.querySelectorAll('.needs-validation');
    
    forms.forEach(form => {
        form.addEventListener('submit', function(event) {
            if (!form.checkValidity()) {
                event.preventDefault();
                event.stopPropagation();
            }
            
            form.classList.add('was-validated');
        });
    });
}

// Email processing functions
function processEmail(emailId) {
    const button = document.querySelector(`[data-email-id="${emailId}"]`);
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i data-feather="loader" class="me-2"></i>Processing...';
        feather.replace();
    }
    
    fetch(`/process_email/${emailId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('Email processed successfully!', 'success');
            // Refresh the page or update the UI
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            showNotification(data.error || 'Failed to process email', 'danger');
        }
    })
    .catch(error => {
        console.error('Error processing email:', error);
        showNotification('Error processing email', 'danger');
    })
    .finally(() => {
        if (button) {
            button.disabled = false;
            button.innerHTML = '<i data-feather="cpu" class="me-2"></i>Process';
            feather.replace();
        }
    });
}

// Sync emails function
function syncEmails() {
    const button = document.getElementById('sync-button');
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i data-feather="loader" class="me-2"></i>Syncing...';
        feather.replace();
    }
    
    fetch('/sync_emails', {
        method: 'POST'
    })
    .then(response => {
        if (response.ok) {
            showNotification('Email sync started. This may take a few minutes.', 'info');
        } else {
            throw new Error('Sync failed');
        }
    })
    .catch(error => {
        console.error('Error syncing emails:', error);
        showNotification('Failed to start email sync', 'danger');
    })
    .finally(() => {
        if (button) {
            button.disabled = false;
            button.innerHTML = '<i data-feather="refresh-cw" class="me-2"></i>Sync Emails';
            feather.replace();
        }
    });
}

// Account management functions
function toggleAccount(accountId) {
    fetch(`/toggle_account/${accountId}`, {
        method: 'POST'
    })
    .then(response => {
        if (response.ok) {
            showNotification('Account status updated', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            throw new Error('Toggle failed');
        }
    })
    .catch(error => {
        console.error('Error toggling account:', error);
        showNotification('Failed to update account status', 'danger');
    });
}

// Utility functions
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

function truncateText(text, maxLength = 100) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// Loading state management
function showLoading(element) {
    element.disabled = true;
    element.setAttribute('data-original-text', element.innerHTML);
    element.innerHTML = '<i data-feather="loader" class="me-2"></i>Loading...';
    feather.replace();
}

function hideLoading(element) {
    element.disabled = false;
    element.innerHTML = element.getAttribute('data-original-text');
    element.removeAttribute('data-original-text');
    feather.replace();
}

// Theme management
function initializeTheme() {
    // The app uses Bootstrap's dark theme by default
    // This function can be extended for theme switching
    document.documentElement.setAttribute('data-bs-theme', 'dark');
}

// Error handling
window.addEventListener('error', function(event) {
    console.error('JavaScript error:', event.error);
    // Optionally show user-friendly error message
});

// Handle fetch errors globally
window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled promise rejection:', event.reason);
    // Optionally show user-friendly error message
});

// Initialize theme on load
initializeTheme();

// Re-initialize Feather icons after any dynamic content updates
function refreshFeatherIcons() {
    feather.replace();
}

// Expose utility functions globally
window.GARA = {
    processEmail,
    syncEmails,
    toggleAccount,
    showNotification,
    formatDate,
    truncateText,
    showLoading,
    hideLoading,
    refreshFeatherIcons
};
