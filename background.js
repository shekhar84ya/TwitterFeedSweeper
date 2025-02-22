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