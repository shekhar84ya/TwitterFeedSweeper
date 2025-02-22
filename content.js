class TwitterNavigator {
  constructor() {
    this.posts = [];
    this.currentIndex = -1;
    this.isEnabled = true;
    this.navigationButtons = null;
    this.debug = true;

    // Listen for state changes from background
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'STATE_CHANGED') {
        this.log('State changed:', message);
        this.handleStateChange(message.isEnabled);
      }
    });

    // Initialize after DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initialize());
    } else {
      this.initialize();
    }

    // Setup mutation observer for dynamic content with detailed logging
    const observer = new MutationObserver((mutations) => {
      if (this.isEnabled) {
        const relevantMutations = mutations.filter(m => 
          m.addedNodes.length > 0 && 
          Array.from(m.addedNodes).some(node => 
            node.nodeType === 1 && 
            (node.matches?.('article') || node.querySelector?.('article'))
          )
        );

        if (relevantMutations.length > 0) {
          this.log('Relevant DOM mutations detected:', {
            mutationCount: relevantMutations.length,
            currentPostCount: this.posts.length
          });
          this.collectVisiblePosts();
        }
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

  handleStateChange(enabled) {
    this.isEnabled = enabled;
    this.log('Handling state change:', { enabled });

    if (!enabled) {
      this.removeNavigationButtons();
      this.posts = [];
      this.currentIndex = -1;
    } else {
      this.initialize();
    }
  }

  async initialize() {
    try {
      const state = await this.getState();
      this.isEnabled = state.isEnabled;
      this.log('Initialized with state:', { isEnabled: this.isEnabled });

      if (!this.isEnabled) {
        this.removeNavigationButtons();
        return;
      }

      // Reset navigation state
      this.posts = [];
      this.currentIndex = -1;

      // Setup UI and collect initial posts
      this.createNavigationButtons();
      this.setupKeyboardNavigation();

      // Initial post collection with detailed logging
      this.log('Starting initial post collection...');
      await this.collectVisiblePosts();

      this.log('Initial collection complete:', { 
        postsFound: this.posts.length,
        postUrls: this.posts 
      });
    } catch (error) {
      this.log('Initialization error:', error);
    }
  }

  async getState() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
        resolve(response || { isEnabled: true });
      });
    });
  }

  removeNavigationButtons() {
    if (this.navigationButtons) {
      this.navigationButtons.remove();
      this.navigationButtons = null;
    }
  }

  async collectVisiblePosts() {
    if (!this.isEnabled) return;

    // Try multiple selectors to find tweets, logging success for each
    const tweetSelectors = [
      'article[data-testid="tweet"]',
      '[data-testid="tweet"]',
      'div[data-testid="cellInnerDiv"] article'
    ];

    let tweets = [];
    let usedSelector = '';
    for (const selector of tweetSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        tweets = Array.from(elements);
        usedSelector = selector;
        this.log('Found tweets using selector:', { 
          selector, 
          count: elements.length 
        });
        break;
      }
    }

    if (tweets.length === 0) {
      this.log('No tweets found with any selector');
      return;
    }

    this.log('Processing tweets:', { 
      usedSelector,
      totalFound: tweets.length,
      currentlyCached: this.posts.length 
    });

    let newPostsFound = false;
    for (const tweet of tweets) {
      try {
        // Log tweet details for debugging
        this.log('Processing tweet:', {
          dataTestId: tweet.getAttribute('data-testid'),
          role: tweet.getAttribute('role'),
          class: tweet.className
        });

        // Find all status links in the tweet
        const links = tweet.querySelectorAll('a[href*="/status/"]');
        const statusLinks = Array.from(links).filter(link => 
          link.href && 
          link.href.match(/\/status\/\d+/) && 
          !link.href.includes('/analytics')
        );

        this.log('Found status links:', { 
          total: links.length,
          validStatus: statusLinks.length
        });

        // Add new status links to posts array
        for (const link of statusLinks) {
          if (!this.posts.includes(link.href)) {
            this.posts.push(link.href);
            newPostsFound = true;
            this.log('New post found:', { url: link.href });
          }
        }
      } catch (error) {
        this.log('Error processing tweet:', error);
      }
    }

    if (newPostsFound) {
      this.log('Posts updated:', { 
        total: this.posts.length,
        latest: this.posts.slice(-5)  // Show last 5 posts added
      });
      this.updateNavigationButtonStates();
    }
  }

  createNavigationButtons() {
    this.removeNavigationButtons();

    this.navigationButtons = document.createElement('div');
    this.navigationButtons.className = 'twitter-navigator-controls';
    this.navigationButtons.innerHTML = `
      <button class="nav-button prev" disabled>Previous</button>
      <button class="nav-button next" disabled>Next</button>
    `;

    document.body.appendChild(this.navigationButtons);

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

    prevButton.disabled = this.currentIndex <= 0;
    nextButton.disabled = this.posts.length === 0 || 
                         (this.currentIndex >= 0 && this.currentIndex >= this.posts.length - 1);

    this.log('Navigation states updated:', {
      prevDisabled: prevButton.disabled,
      nextDisabled: nextButton.disabled,
      currentIndex: this.currentIndex,
      totalPosts: this.posts.length
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

  navigate(direction) {
    if (!this.isEnabled || this.posts.length === 0) {
      this.log('Navigation blocked:', { 
        enabled: this.isEnabled, 
        postsCount: this.posts.length 
      });
      return;
    }

    let targetIndex = this.currentIndex;

    if (direction === 'next') {
      if (this.currentIndex === -1 || this.currentIndex >= this.posts.length - 1) {
        targetIndex = 0;
      } else {
        targetIndex = this.currentIndex + 1;
      }
    } else if (direction === 'prev' && this.currentIndex > 0) {
      targetIndex = this.currentIndex - 1;
    }

    if (targetIndex >= 0 && targetIndex < this.posts.length) {
      this.currentIndex = targetIndex;
      this.log('Navigating:', {
        direction,
        toIndex: this.currentIndex,
        url: this.posts[this.currentIndex]
      });

      this.updateNavigationButtonStates();
      window.location.href = this.posts[this.currentIndex];
    }
  }
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new TwitterNavigator());
} else {
  new TwitterNavigator();
}