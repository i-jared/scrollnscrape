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
    this.scrapeAndScroll();
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

  private scrapeTweets() {
    const tweetSelector = '[data-testid="tweet"]';
    const tweetElements = document.querySelectorAll(tweetSelector);
    let newTweetsFound = 0;

    // Process tweets and detect threads
    const processedTweets = this.processTweetsForThreads(Array.from(tweetElements));
    
    processedTweets.forEach(processedTweet => {
      // Create unique identifier
      const uniqueId = `${processedTweet.text.substring(0, 50)}_${processedTweet.timestamp}`;
      
      // Check if tweet already exists
      if (!this.allTweets.some(tweet => {
        const existingId = `${tweet.text.substring(0, 50)}_${tweet.timestamp}`;
        return existingId === uniqueId || tweet.text === processedTweet.text;
      })) {
        this.allTweets.push(processedTweet);
        newTweetsFound++;
      }
    });

    console.log(`Scraped ${this.allTweets.length} unique tweets so far (${newTweetsFound} new).`);
    this.sendStatusUpdate(`Scraped ${this.allTweets.length} tweets...`);
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

    return {
      text: tweetText,
      timestamp: timestamp,
      author: author
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
    if (this.config.scrapeAll) {
      return false;
    }
    
    if (this.config.maxTweets && this.allTweets.length >= this.config.maxTweets) {
      return true;
    }

    return false;
  }

  private scrollDown() {
    window.scrollTo(0, document.body.scrollHeight);
  }

  private scrapeAndScroll() {
    if (!this.isActive) return;

    this.scrapeTweets();
    
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