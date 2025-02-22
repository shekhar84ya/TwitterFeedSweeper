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

    // Start initialization after a short delay to ensure DOM is ready
    setTimeout(() => this.initialize(), 1000);
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

    const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');
    let newPostsFound = false;
    let newPostCount = 0;

    tweetElements.forEach(tweet => {
      const tweetLink = tweet.querySelector('a[href*="/status/"]');
      if (tweetLink && !this.postCache.includes(tweetLink.href)) {
        if (tweetLink.href.match(/\/status\/\d+/)) {
          this.postCache.push(tweetLink.href);
          newPostsFound = true;
          newPostCount++;
        }
      }
    });

    if (newPostsFound) {
      await chrome.storage.local.set({ postCache: this.postCache });
      this.log('New posts collected:', { newPosts: newPostCount, totalPosts: this.postCache.length });
      this.updateNavigationButtonStates();
    }
  }

  createNavigationButtons() {
    if (!this.isEnabled) return;

    this.removeNavigationButtons();

    this.navigationButtons = document.createElement('div');
    this.navigationButtons.className = 'twitter-navigator-controls';
    this.navigationButtons.innerHTML = `
      <button class="nav-button prev" ${this.currentIndex <= 0 ? 'disabled' : ''}>Previous</button>
      <button class="nav-button next">Next</button>
    `;

    document.body.appendChild(this.navigationButtons);
    this.log('Navigation buttons created');

    this.navigationButtons.querySelector('.prev').addEventListener('click', () => this.navigate('prev'));
    this.navigationButtons.querySelector('.next').addEventListener('click', () => this.navigate('next'));
  }

  updateNavigationButtonStates() {
    if (!this.navigationButtons) return;

    const prevButton = this.navigationButtons.querySelector('.prev');
    const nextButton = this.navigationButtons.querySelector('.next');

    prevButton.disabled = this.currentIndex <= 0;
    nextButton.disabled = this.postCache.length === 0;
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

    if (this.currentIndex === -1 || (direction === 'next' && this.currentIndex === this.postCache.length - 1)) {
      this.currentIndex = 0;
    } else if (direction === 'next' && this.currentIndex < this.postCache.length - 1) {
      this.currentIndex++;
    } else if (direction === 'prev' && this.currentIndex > 0) {
      this.currentIndex--;
    } else {
      this.log('Navigation at boundary:', { direction, currentIndex: this.currentIndex });
      return;
    }

    chrome.storage.local.set({ currentIndex: this.currentIndex });
    this.log('Navigating:', { 
      direction,
      fromIndex: prevIndex,
      toIndex: this.currentIndex,
      totalPosts: this.postCache.length
    });

    this.updateNavigationButtonStates();
    window.location.href = this.postCache[this.currentIndex];
  }
}

// Initialize the navigator when the page is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new TwitterNavigator());
} else {
  new TwitterNavigator();
}