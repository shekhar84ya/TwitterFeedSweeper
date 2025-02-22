class TwitterNavigator {
  constructor() {
    this.postCache = [];
    this.currentIndex = -1;
    this.isEnabled = true;
    this.navigationButtons = null;
    this.lastCollectionTime = 0;
    this.debug = true;

    // Listen for state changes from background
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'STATE_CHANGED') {
        this.log('State changed via message:', message);
        this.handleStateChange(message.isEnabled);
      }
    });

    // Start initialization after DOM is loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initialize());
    } else {
      this.initialize();
    }

    // Set up periodic post collection
    setInterval(() => this.collectPosts(), 2000);

    // Add mutation observer for dynamic content
    const observer = new MutationObserver(() => {
      if (this.isEnabled) {
        this.collectPosts();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  log(message, data = null) {
    if (this.debug) {
      console.log(`[Twitter Navigator] ${message}`, data || '');
    }
  }

  async handleStateChange(enabled) {
    this.isEnabled = enabled;
    this.log('Handling state change:', { enabled });

    if (!enabled) {
      this.removeNavigationButtons();
      this.postCache = [];
      this.currentIndex = -1;
    } else {
      await this.initialize();
    }
  }

  async initialize() {
    try {
      // Get initial state
      const state = await this.getState();
      this.isEnabled = state.isEnabled;
      this.log('Extension initialized with state:', { isEnabled: this.isEnabled });

      if (!this.isEnabled) {
        this.removeNavigationButtons();
        return;
      }

      // Create navigation UI immediately
      this.createNavigationButtons();
      this.setupKeyboardNavigation();
      this.setupInfiniteScrollObserver();

      // Start collecting posts
      await this.collectPosts();
      this.log('Initial posts collected:', { cacheSize: this.postCache.length });

      // Load cache if needed
      if (this.postCache.length === 0) {
        await this.loadCache();
        this.log('Cache loaded:', { cacheSize: this.postCache.length });
      }

      // Update button states
      this.updateNavigationButtonStates();
    } catch (error) {
      this.log('Error during initialization:', error);
    }
  }

  async getState() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
        this.log('Got state from background:', response);
        resolve(response || { isEnabled: true });
      });
    });
  }

  async loadCache() {
    const result = await chrome.storage.local.get(['postCache', 'currentIndex']);
    if (result.postCache) {
      this.postCache = result.postCache;
      this.currentIndex = result.currentIndex || -1;
    }
    this.log('Loaded cache from storage:', { cacheSize: this.postCache.length, currentIndex: this.currentIndex });
  }

  removeNavigationButtons() {
    if (this.navigationButtons) {
      this.navigationButtons.remove();
      this.navigationButtons = null;
    }
  }

  async collectPosts() {
    if (!this.isEnabled) return;

    const now = Date.now();
    if (now - this.lastCollectionTime < 1000) return;
    this.lastCollectionTime = now;

    // Try multiple selectors to find tweets, in order of specificity
    const tweetSelectors = [
      'article[data-testid="tweet"]',
      '[data-testid="tweet"]',
      '[role="article"]',
      'div[data-testid^="cellInnerDiv"]'
    ];

    let tweetElements = [];
    for (const selector of tweetSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        tweetElements = Array.from(elements);
        this.log('Found tweets using selector:', { selector, count: elements.length });
        break;
      }
    }

    let newPostsFound = false;
    let newPostCount = 0;

    for (const tweet of tweetElements) {
      try {
        // Find links that match tweet status pattern
        const links = Array.from(tweet.querySelectorAll('a[href*="/status/"]'));
        const statusLink = links.find(link => {
          const href = link.href;
          return href && href.match(/\/status\/\d+/) && !href.includes('/analytics');
        });

        if (statusLink && !this.postCache.includes(statusLink.href)) {
          this.postCache.push(statusLink.href);
          newPostsFound = true;
          newPostCount++;
          this.log('New tweet found:', { href: statusLink.href });
        }
      } catch (error) {
        this.log('Error processing tweet:', error);
        continue;
      }
    }

    if (newPostsFound) {
      try {
        await chrome.storage.local.set({ postCache: this.postCache });
        this.log('Cache updated:', { 
          newPosts: newPostCount, 
          totalPosts: this.postCache.length,
          sample: this.postCache.slice(-3) 
        });
        this.updateNavigationButtonStates();
      } catch (error) {
        this.log('Error updating cache:', error);
      }
    }
  }

  createNavigationButtons() {
    if (!this.isEnabled) return;

    this.removeNavigationButtons();

    this.navigationButtons = document.createElement('div');
    this.navigationButtons.className = 'twitter-navigator-controls';
    this.navigationButtons.innerHTML = `
      <button class="nav-button prev" ${this.currentIndex <= 0 ? 'disabled' : ''}>Previous</button>
      <button class="nav-button next" ${this.postCache.length === 0 ? 'disabled' : ''}>Next</button>
    `;

    document.body.appendChild(this.navigationButtons);
    this.log('Navigation buttons created');

    const prevButton = this.navigationButtons.querySelector('.prev');
    const nextButton = this.navigationButtons.querySelector('.next');

    prevButton.addEventListener('click', () => this.navigate('prev'));
    nextButton.addEventListener('click', () => this.navigate('next'));

    this.updateNavigationButtonStates();
  }

  updateNavigationButtonStates() {
    if (!this.navigationButtons) return;

    const prevButton = this.navigationButtons.querySelector('.prev');
    const nextButton = this.navigationButtons.querySelector('.next');

    // Enable next button if we have posts and either haven't started (-1) or haven't reached the end
    prevButton.disabled = this.currentIndex <= 0;
    nextButton.disabled = this.postCache.length === 0 ||
                         (this.currentIndex >= 0 && this.currentIndex >= this.postCache.length - 1);

    this.log('Button states updated:', {
      prevDisabled: prevButton.disabled,
      nextDisabled: nextButton.disabled,
      currentIndex: this.currentIndex,
      cacheSize: this.postCache.length
    });
  }

  setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
      if (!this.isEnabled) return;

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.navigate('prev');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.navigate('next');
      }
    });
  }

  setupInfiniteScrollObserver() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && this.isEnabled) {
          this.log('Timeline scroll detected, collecting new posts');
          this.collectPosts();
        }
      });
    }, { threshold: 0.5 });

    const timeline = document.querySelector('[data-testid="primaryColumn"]');
    if (timeline) {
      observer.observe(timeline);
      this.log('Infinite scroll observer setup on timeline');
    }
  }

  navigate(direction) {
    if (!this.isEnabled || this.postCache.length === 0) {
      this.log('Navigation blocked:', { enabled: this.isEnabled, cacheSize: this.postCache.length });
      return;
    }

    const prevIndex = this.currentIndex;
    let targetIndex = this.currentIndex;

    if (direction === 'next') {
      // If we haven't started or are at the end, go to the first post
      if (this.currentIndex === -1 || this.currentIndex >= this.postCache.length - 1) {
        targetIndex = 0;
      } else {
        targetIndex = this.currentIndex + 1;
      }
    } else if (direction === 'prev' && this.currentIndex > 0) {
      targetIndex = this.currentIndex - 1;
    }

    // Validate the target URL before navigating
    if (targetIndex >= 0 && targetIndex < this.postCache.length) {
      this.currentIndex = targetIndex;

      // Save state before navigation
      try {
        chrome.storage.local.set({ currentIndex: this.currentIndex });

        this.log('Navigating:', {
          direction,
          fromIndex: prevIndex,
          toIndex: this.currentIndex,
          totalPosts: this.postCache.length,
          url: this.postCache[this.currentIndex]
        });

        this.updateNavigationButtonStates();
        window.location.href = this.postCache[this.currentIndex];
      } catch (error) {
        this.log('Error during navigation:', error);
      }
    } else {
      this.log('Invalid navigation target:', { targetIndex, cacheSize: this.postCache.length });
    }
  }
}

// Initialize the navigator when the page is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new TwitterNavigator());
} else {
  new TwitterNavigator();
}