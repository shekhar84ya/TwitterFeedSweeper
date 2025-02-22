class TwitterNavigator {
  constructor() {
    this.postCache = [];
    this.currentIndex = -1;
    this.isEnabled = true;
    this.navigationButtons = null;
    this.lastCollectionTime = 0;
    this.debug = true; // Enable logging temporarily for debugging

    this.initialize();
  }

  log(message, data = null) {
    if (this.debug) {
      console.log(`[Twitter Navigator] ${message}`, data || '');
    }
  }

  async initialize() {
    // Check if extension is enabled
    const state = await this.getState();
    this.isEnabled = state.isEnabled;
    this.log('Extension initialized with state:', { isEnabled: this.isEnabled });

    if (!this.isEnabled) {
      this.removeNavigationButtons();
      return;
    }

    // Start collecting posts immediately
    await this.collectPosts();
    this.log('Initial posts collected:', { cacheSize: this.postCache.length });

    // Initialize cache only if not already set
    if (this.postCache.length === 0) {
      await this.loadCache();
      this.log('Cache loaded:', { cacheSize: this.postCache.length });
    }

    // Setup navigation only if we have posts
    if (this.postCache.length > 0) {
      this.createNavigationButtons();
      this.setupKeyboardNavigation();
      this.setupInfiniteScrollObserver();
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
    // Throttle collection to avoid excessive DOM operations
    const now = Date.now();
    if (now - this.lastCollectionTime < 1000) return;
    this.lastCollectionTime = now;

    const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');
    let newPostsFound = false;
    let newPostCount = 0;

    tweetElements.forEach(tweet => {
      const tweetLink = tweet.querySelector('a[href*="/status/"]');
      if (tweetLink && !this.postCache.includes(tweetLink.href)) {
        // Filter out non-post URLs (like profile links)
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

      // If this is our first post and we haven't navigated yet, show the buttons
      if (this.postCache.length === newPostCount && !this.navigationButtons) {
        this.createNavigationButtons();
      }
    }
  }

  createNavigationButtons() {
    this.removeNavigationButtons(); // Remove existing buttons if any

    this.navigationButtons = document.createElement('div');
    this.navigationButtons.className = 'twitter-navigator-controls';
    this.navigationButtons.innerHTML = `
      <button class="nav-button prev" ${this.currentIndex <= 0 ? 'disabled' : ''}>Previous</button>
      <button class="nav-button next">Next</button>
    `;

    document.body.appendChild(this.navigationButtons);
    this.log('Navigation buttons created:', { position: this.currentIndex, total: this.postCache.length });

    this.navigationButtons.querySelector('.prev').addEventListener('click', () => this.navigate('prev'));
    this.navigationButtons.querySelector('.next').addEventListener('click', () => this.navigate('next'));
  }

  setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
      if (!this.isEnabled) return;

      // Don't trigger when typing in input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.log('Left arrow pressed');
        this.navigate('prev');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.log('Right arrow pressed');
        this.navigate('next');
      }
    });
  }

  setupInfiniteScrollObserver() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          this.log('Timeline scroll detected, collecting new posts');
          this.collectPosts();
        }
      });
    }, { threshold: 0.5 });

    // Observe the timeline to detect scrolling
    const timeline = document.querySelector('[data-testid="primaryColumn"]');
    if (timeline) {
      observer.observe(timeline);
      this.log('Infinite scroll observer setup on timeline');
    } else {
      this.log('Warning: Timeline element not found for scroll observer');
    }
  }

  navigate(direction) {
    if (!this.isEnabled || this.postCache.length === 0) {
      this.log('Navigation blocked:', { enabled: this.isEnabled, cacheSize: this.postCache.length });
      return;
    }

    const prevIndex = this.currentIndex;

    // For first navigation or 'next', go to first post
    if (this.currentIndex === -1 || (direction === 'next' && this.currentIndex === this.postCache.length - 1)) {
      this.currentIndex = 0;
    } else if (direction === 'next' && this.currentIndex < this.postCache.length - 1) {
      this.currentIndex++;
    } else if (direction === 'prev' && this.currentIndex > 0) {
      this.currentIndex--;
    } else {
      this.log('Navigation at boundary:', { direction, currentIndex: this.currentIndex });
      return; // Don't navigate if we're at the bounds
    }

    chrome.storage.local.set({ currentIndex: this.currentIndex });
    this.log('Navigating:', { 
      direction,
      fromIndex: prevIndex,
      toIndex: this.currentIndex,
      totalPosts: this.postCache.length
    });

    // Update button states
    if (this.navigationButtons) {
      this.navigationButtons.querySelector('.prev').disabled = this.currentIndex <= 0;
      this.navigationButtons.querySelector('.next').disabled = false; // Always enable next for circular navigation
    }

    window.location.href = this.postCache[this.currentIndex];
  }
}

// Initialize the navigator when the page is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new TwitterNavigator());
} else {
  new TwitterNavigator();
}