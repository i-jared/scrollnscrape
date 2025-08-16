import type { PlasmoContentScript } from "plasmo"

export const config: PlasmoContentScript = {
  matches: ["https://x.com/*", "https://twitter.com/*"]
}

interface ScrapingConfig {
  maxTweets?: number;
  dateRange?: {
    start: string;
    end: string;
  };
  scrapeAll: boolean;
}

interface ScrapedTweet {
  text: string;
  timestamp?: string;
  author?: string;
  isThread?: boolean;
  threadTweets?: string[];
  threadPosition?: number;
  quotedTweetUrl?: string;
  mediaUrls?: string[];
}

class TwitterScraper {
  private allTweets: ScrapedTweet[] = [];
  private scrollInterval: NodeJS.Timeout | null = null;
  private isActive = false;
  private config: ScrapingConfig = { scrapeAll: true };

  constructor() {
    this.setupMessageListener();
  }

  private setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.action) {
        case 'START_SCRAPING':
          this.startScraping(message.config);
          sendResponse({ status: 'started' });
          break;
        case 'STOP_SCRAPING':
          this.stopScraping();
          sendResponse({ status: 'stopped' });
          break;
        case 'GET_STATUS':
          sendResponse({
            isActive: this.isActive,
            tweetCount: this.allTweets.length
          });
          break;
        case 'GET_TWEETS':
          sendResponse({ tweets: this.allTweets });
          break;
      }
    });
  }

  private startScraping(config: ScrapingConfig) {
    if (this.isActive) {
      return;
    }

    this.config = config;
    this.isActive = true;
    this.allTweets = [];

    console.log('Starting tweet scraping with config:', config);
    
    this.sendStatusUpdate('Starting scraping...');
    
    // For date range scraping, first scroll to find tweets in range
    if (config.dateRange) {
      this.scrollToDateRange();
    } else {
      this.scrapeAndScroll();
    }
  }

  private stopScraping() {
    if (this.scrollInterval) {
      clearInterval(this.scrollInterval);
      this.scrollInterval = null;
    }
    this.isActive = false;
    
    console.log(`Finished scraping ${this.allTweets.length} tweets.`);
    this.sendStatusUpdate('Scraping completed');
    this.sendScrapingComplete();
  }

  private async scrapeTweets() {
    const tweetSelector = '[data-testid="tweet"]';
    const tweetElements = document.querySelectorAll(tweetSelector);
    
    // First, expand all "Show more" buttons
    await this.expandTruncatedTweets();
    
    let newTweetsFound = 0;

    // Process tweets and detect threads
    const processedTweets = this.processTweetsForThreads(Array.from(tweetElements));
    
    processedTweets.forEach(processedTweet => {
      // Check if we've already reached the target limit
      if (this.config.maxTweets && this.allTweets.length >= this.config.maxTweets) {
        return; // Stop adding tweets if we've reached the limit
      }

      // Check date range filtering
      if (this.config.dateRange && processedTweet.timestamp) {
        const tweetDate = new Date(processedTweet.timestamp);
        const startDate = new Date(this.config.dateRange.start);
        const endDate = new Date(this.config.dateRange.end);
        
        // Skip tweet if it's outside the date range
        if (tweetDate < startDate || tweetDate > endDate) {
          return;
        }
      }

      // Create unique identifier
      const uniqueId = `${processedTweet.text.substring(0, 50)}_${processedTweet.timestamp}`;
      
      // Check if tweet already exists
      if (!this.allTweets.some(tweet => {
        const existingId = `${tweet.text.substring(0, 50)}_${tweet.timestamp}`;
        return existingId === uniqueId || tweet.text === processedTweet.text;
      })) {
        // Double-check we haven't exceeded the limit before adding
        if (!this.config.maxTweets || this.allTweets.length < this.config.maxTweets) {
          this.allTweets.push(processedTweet);
          newTweetsFound++;
        }
      }
    });

    console.log(`Scraped ${this.allTweets.length} unique tweets so far (${newTweetsFound} new).`);
    
    // More informative status for date range scraping
    if (this.config.dateRange) {
      this.sendStatusUpdate(`Found ${this.allTweets.length} tweets in date range, scrolling...`);
    } else {
      this.sendStatusUpdate(`Scraped ${this.allTweets.length} tweets...`);
    }
  }

  private async expandTruncatedTweets() {
    // Find all "Show more" elements, but filter for main tweet buttons only
    const showMoreElements = document.querySelectorAll('[data-testid="tweet-text-show-more-link"]');
    const mainTweetButtons: HTMLElement[] = [];
    
    showMoreElements.forEach(element => {
      // Only click if it's a button (main tweet), not a link (quoted tweet)
      if (element.tagName.toLowerCase() === 'button' && element instanceof HTMLElement) {
        // Additional check: make sure it's not inside a quoted tweet container
        const isInQuotedTweet = element.closest('[role="link"]')?.getAttribute('tabindex') === '0';
        if (!isInQuotedTweet) {
          mainTweetButtons.push(element);
        }
      }
    });
    
    if (mainTweetButtons.length > 0) {
      console.log(`Found ${mainTweetButtons.length} main tweet "Show more" buttons, clicking them...`);
      
      // Click only the main tweet show more buttons
      mainTweetButtons.forEach(button => {
        button.click();
      });
      
      // Wait a short time for content to expand
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  private processTweetsForThreads(tweetElements: Element[]): ScrapedTweet[] {
    const processedTweets: ScrapedTweet[] = [];
    let currentThread: ScrapedTweet[] = [];
    let lastAuthor = '';

    tweetElements.forEach((tweetElement, index) => {
      const tweetData = this.extractTweetData(tweetElement);
      if (!tweetData) return;

      // Check if this is part of a thread
      const isThreadContinuation = this.isThreadContinuation(tweetElement, lastAuthor, tweetData.author);
      
      if (isThreadContinuation && currentThread.length > 0) {
        // Add to current thread
        currentThread.push(tweetData);
      } else {
        // Process previous thread if exists
        if (currentThread.length > 1) {
          this.finalizeThread(currentThread);
          processedTweets.push(...currentThread);
        } else if (currentThread.length === 1) {
          // Single tweet, not a thread
          processedTweets.push(currentThread[0]);
        }
        
        // Start new potential thread
        currentThread = [tweetData];
        lastAuthor = tweetData.author || '';
      }
    });

    // Handle last thread
    if (currentThread.length > 1) {
      this.finalizeThread(currentThread);
      processedTweets.push(...currentThread);
    } else if (currentThread.length === 1) {
      processedTweets.push(currentThread[0]);
    }

    return processedTweets;
  }

  private extractTweetData(tweetElement: Element): ScrapedTweet | null {
    // Multiple strategies to find tweet text
    let tweetTextElement = tweetElement.querySelector('[data-testid="tweetText"]');
    
    // Fallback: look for any element with tweet text patterns
    if (!tweetTextElement) {
      // Look for elements with lang attribute (common for tweet text)
      const langElements = tweetElement.querySelectorAll('[lang]');
      for (const element of langElements) {
        const text = element.textContent?.trim();
        if (text && text.length > 10 && !text.includes('·') && !text.startsWith('@')) {
          tweetTextElement = element;
          break;
        }
      }
    }

    // Another fallback: look for div elements with substantial text content
    if (!tweetTextElement) {
      const divElements = tweetElement.querySelectorAll('div[dir="auto"], div[dir="ltr"]');
      for (const element of divElements) {
        const text = element.textContent?.trim();
        if (text && text.length > 20 && !text.includes('Repost') && !text.includes('Like') && !text.includes('Reply')) {
          // Check if this div is likely tweet content (not UI elements)
          const parent = element.parentElement;
          if (parent && !parent.querySelector('button') && !text.match(/^\d+$/)) {
            tweetTextElement = element;
            break;
          }
        }
      }
    }
    
    if (!tweetTextElement) return null;

    const tweetText = tweetTextElement.textContent?.trim() || '';
    
    // Skip empty or very short text, and UI elements
    if (tweetText.length < 2 || 
        tweetText.match(/^(\d+|·|@\w+|Show|Hide|More|Reply|Repost|Quote|Like|Share)$/)) {
      return null;
    }
    
    // Extract timestamp
    const timeElement = tweetElement.querySelector('time');
    const timestamp = timeElement?.getAttribute('datetime') || '';
    
    // Extract author
    const authorElement = tweetElement.querySelector('[data-testid="User-Name"] span span') || 
                          tweetElement.querySelector('[data-testid="User-Name"]');
    const author = authorElement?.textContent?.trim() || '';

    // Extract quoted tweet URL if present
    let quotedTweetUrl = '';
    const quotedTweetLink = tweetElement.querySelector('a[href*="/status/"][data-testid="tweet-text-show-more-link"]');
    if (quotedTweetLink) {
      const href = quotedTweetLink.getAttribute('href');
      if (href) {
        // Convert relative URL to absolute URL
        quotedTweetUrl = href.startsWith('http') ? href : `https://x.com${href}`;
      }
    }

    // Extract media URLs (images, videos, etc.)
    const mediaUrls: string[] = [];
    
    // Look for photo links
    const photoLinks = tweetElement.querySelectorAll('a[href*="/photo/"]');
    photoLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href) {
        const fullUrl = href.startsWith('http') ? href : `https://x.com${href}`;
        mediaUrls.push(fullUrl);
      }
    });

    // Look for video links
    const videoLinks = tweetElement.querySelectorAll('a[href*="/video/"]');
    videoLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href) {
        const fullUrl = href.startsWith('http') ? href : `https://x.com${href}`;
        mediaUrls.push(fullUrl);
      }
    });

    // Look for direct media URLs (images and videos)
    const mediaElements = tweetElement.querySelectorAll('img[src*="pbs.twimg.com"], video[poster*="pbs.twimg.com"]');
    mediaElements.forEach(element => {
      const src = element.getAttribute('src') || element.getAttribute('poster');
      if (src && src.includes('pbs.twimg.com')) {
        mediaUrls.push(src);
      }
    });

    return {
      text: tweetText,
      timestamp: timestamp,
      author: author,
      quotedTweetUrl: quotedTweetUrl || undefined,
      mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined
    };
  }

  private isThreadContinuation(tweetElement: Element, lastAuthor: string, currentAuthor: string): boolean {
    // Look for the specific thread connection indicator
    // This is the key element that shows a visual connecting line between tweets
    const hasThreadConnector = tweetElement.querySelector('.r-1bnu78o.r-f8sm7e.r-m5arl1.r-16y2uox.r-14gqq1x');
    
    // Alternative: check if previous sibling or parent container has the thread connector
    const parentContainer = tweetElement.closest('[data-testid="cellInnerDiv"]');
    const hasPreviousThreadConnector = parentContainer?.previousElementSibling?.querySelector('.r-1bnu78o.r-f8sm7e.r-m5arl1.r-16y2uox.r-14gqq1x');
    
    // Only consider it a thread if we have the visual connecting line AND same author
    if ((hasThreadConnector || hasPreviousThreadConnector) && lastAuthor && currentAuthor && lastAuthor === currentAuthor) {
      return true;
    }

    return false;
  }

  private finalizeThread(threadTweets: ScrapedTweet[]) {
    const threadTexts = threadTweets.map(t => t.text);
    
    threadTweets.forEach((tweet, index) => {
      tweet.isThread = true;
      tweet.threadTweets = threadTexts;
      tweet.threadPosition = index + 1;
    });
  }

  private shouldStopScraping(): boolean {
    // Always respect max tweets limit first
    if (this.config.maxTweets && this.allTweets.length >= this.config.maxTweets) {
      return true;
    }

    // For scrape all mode, never stop
    if (this.config.scrapeAll) {
      return false;
    }

    // For date range scraping, check if we've scrolled past the start date (older tweets)
    if (this.config.dateRange) {
      const startDate = new Date(this.config.dateRange.start);
      const currentPageTweets = this.getCurrentTweetDates(5);
      
      // If we have tweets and ALL visible tweets are older than start date, stop
      if (currentPageTweets.length >= 3 && 
          currentPageTweets.every(date => date < startDate)) {
        console.log('All current tweets are older than start date, stopping');
        return true;
      }
    }

    return false;
  }

  private scrollDown() {
    window.scrollTo(0, document.body.scrollHeight);
  }

  private async scrollToDateRange() {
    if (!this.config.dateRange) return;

    const startDate = new Date(this.config.dateRange.start);
    const endDate = new Date(this.config.dateRange.end);
    
    this.sendStatusUpdate('Finding tweets in date range...');
    
    let attempts = 0;
    const maxAttempts = 50; // Prevent infinite scrolling
    
    while (attempts < maxAttempts && this.isActive) {
      // Check the first few tweets to see their dates
      const currentTweets = this.getCurrentTweetDates(3);
      
      if (currentTweets.length === 0) {
        // No tweets found, scroll down and try again
        this.scrollDown();
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
        continue;
      }

      // Check if any tweets are in our date range
      const hasInRangeTweets = currentTweets.some(date => date >= startDate && date <= endDate);
      
      if (hasInRangeTweets) {
        // Found tweets in range, start normal scraping
        console.log('Found tweets in date range, starting scraping');
        this.sendStatusUpdate('Found tweets in range, scraping...');
        this.scrapeAndScroll();
        return;
      }

      // Check if we need to scroll up or down
      const allTweetsAfterRange = currentTweets.every(date => date > endDate);
      const allTweetsBeforeRange = currentTweets.every(date => date < startDate);

      if (allTweetsAfterRange) {
        // All tweets are too new, need to scroll down to get older tweets
        this.scrollDown();
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else if (allTweetsBeforeRange) {
        // All tweets are too old, but we might find some in range by continuing to scroll
        // Don't stop immediately, continue scrolling for a few more attempts
        if (attempts > 40) {  // Give it more chances before giving up
          console.log('Scrolled past date range, no tweets found in specified period');
          this.sendStatusUpdate('No tweets found in date range');
          this.stopScraping();
          return;
        }
        this.scrollDown();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      attempts++;
    }

    if (attempts >= maxAttempts) {
      console.log('Max scroll attempts reached, starting scraping from current position');
      this.sendStatusUpdate('Starting scraping from current position');
      this.scrapeAndScroll();
    }
  }

  private getCurrentTweetDates(count: number = 3): Date[] {
    const tweetSelector = '[data-testid="tweet"]';
    const tweetElements = Array.from(document.querySelectorAll(tweetSelector)).slice(0, count);
    const dates: Date[] = [];

    tweetElements.forEach(element => {
      const timeElement = element.querySelector('time');
      const datetime = timeElement?.getAttribute('datetime');
      if (datetime) {
        dates.push(new Date(datetime));
      }
    });

    return dates;
  }

  private getLatestTweets(count: number): ScrapedTweet[] {
    const tweetSelector = '[data-testid="tweet"]';
    const tweetElements = Array.from(document.querySelectorAll(tweetSelector)).slice(0, count);
    const tweets: ScrapedTweet[] = [];

    tweetElements.forEach(element => {
      const tweetData = this.extractTweetData(element);
      if (tweetData) {
        tweets.push(tweetData);
      }
    });

    return tweets;
  }

  private async scrapeAndScroll() {
    if (!this.isActive) return;

    await this.scrapeTweets();
    
    // Check if we should stop BEFORE scrolling to get more accurate counts
    if (this.shouldStopScraping()) {
      this.stopScraping();
      return;
    }

    this.scrollDown();
    
    // Set interval for next scrape
    this.scrollInterval = setTimeout(() => {
      this.scrapeAndScroll();
    }, 3000); // 3 second delay to allow content to load
  }

  private sendStatusUpdate(message: string) {
    chrome.runtime.sendMessage({
      action: 'STATUS_UPDATE',
      message,
      tweetCount: this.allTweets.length
    });
  }

  private sendScrapingComplete() {
    chrome.runtime.sendMessage({
      action: 'SCRAPING_COMPLETE',
      tweets: this.allTweets,
      tweetCount: this.allTweets.length
    });
  }
}

// Initialize scraper when content script loads
if (window.location.hostname === 'x.com' || window.location.hostname === 'twitter.com') {
  console.log('Twitter Scraper content script loaded');
  new TwitterScraper();
}