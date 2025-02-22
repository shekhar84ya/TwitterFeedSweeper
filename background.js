let isEnabled = true;

function log(message, data = null) {
  console.log(`[Twitter Navigator Background] ${message}`, data || '');
}

// Initialize extension state
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ 
    isEnabled: true,
    postCache: [],
    currentIndex: -1
  });
  log('Extension installed with initial state:', { isEnabled: true });
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-extension') {
    chrome.storage.local.get(['isEnabled'], (result) => {
      const newState = !(result.isEnabled ?? true);
      log('Extension toggled via shortcut:', { newState });

      chrome.storage.local.set({ 
        isEnabled: newState,
        // Reset cache and index when disabling
        ...((!newState) && {
          postCache: [],
          currentIndex: -1
        })
      });

      // Notify any active Twitter tabs
      chrome.tabs.query({ url: ['*://*.twitter.com/*', '*://*.x.com/*'] }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: 'STATE_CHANGED', isEnabled: newState });
        });
      });

      // Only reload if enabling and on Twitter/X
      if (newState) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const currentTab = tabs[0];
          if (currentTab?.url.match(/(twitter\.com|x\.com)/)) {
            log('Reloading Twitter tab:', { tabId: currentTab.id, url: currentTab.url });
            chrome.tabs.reload(currentTab.id);
          }
        });
      }
    });
  }
});

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_STATE') {
    chrome.storage.local.get(['isEnabled'], (result) => {
      log('State requested:', result);
      sendResponse({ isEnabled: result.isEnabled ?? true });
    });
    return true; // Keep message channel open for async response
  }

  if (request.type === 'TOGGLE_STATE') {
    isEnabled = request.enabled;
    log('State toggled:', { newState: isEnabled });

    chrome.storage.local.set({ 
      isEnabled,
      // Reset cache and index when disabling
      ...((!isEnabled) && {
        postCache: [],
        currentIndex: -1
      })
    });

    // Only reload if we're on Twitter/X and enabling
    if (request.enabled) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        if (currentTab?.url.match(/(twitter\.com|x\.com)/)) {
          log('Reloading Twitter tab:', { tabId: currentTab.id, url: currentTab.url });
          chrome.tabs.reload(currentTab.id);
        }
      });
    }
  }
});