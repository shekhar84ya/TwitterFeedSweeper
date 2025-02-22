document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('enableToggle');

  // Load initial state
  chrome.storage.local.get(['isEnabled'], (result) => {
    toggle.checked = result.isEnabled ?? true; // Default to enabled if not set
  });

  // Handle toggle changes
  toggle.addEventListener('change', () => {
    const isEnabled = toggle.checked;

    // Get current tab to check if we're on Twitter/X
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      const isTwitter = currentTab?.url.match(/(twitter\.com|x\.com)/);

      // Send toggle state update
      chrome.runtime.sendMessage({ 
        type: 'TOGGLE_STATE',
        enabled: isEnabled
      });

      // Close popup after toggling
      window.close();
    });
  });
});