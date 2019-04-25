const Apify = require('apify');
const { sourceList } = require('../data');
const {
    extractDetail,
    listPageFunction
} = require('./extraction.js');
const {
    getAttribute,
    enqueueLinks,
    addUrlParameters,
    getWorkingBrowser
} = require('./util.js');

/** Main function */
Apify.main(async () => {
    Apify.openKeyValueStore();
    const input = await Apify.getValue('INPUT');

    // Actor STATE variable
    const state = await Apify.getValue('STATE') || {
        crawled: {}
    };

    // Migrating flag
    let migrating = false;
    Apify.events.on('migrating', () => {
        migrating = true;
    });

    if (!(input.proxyConfig && input.proxyConfig.useApifyProxy)) {
        throw new Error('This actor cannot be used without Apify proxy.');
    }

    // Main request queue.
    const requestQueue = await Apify.openRequestQueue();

    let startUrl;
    let requestList;
    let sources = [];

    // Create startURL based on provided INPUT.
    startUrl = input.startUrl;

    // Enqueue all pagination pages.
    startUrl += '?cpt2=1%2F200';
    startUrl += '&offset=0';
    console.log(`startUrl: ${startUrl}`);
    await requestQueue.addRequest(new Apify.Request({
        url: startUrl
    }));

    requestList = new Apify.RequestList({
        sources: sourceList,
    });
    console.table(sourceList);
    await requestList.initialize();

    // Simulated browser chache
    const cache = {};

    // Main crawler variable.
    const crawler = new Apify.PuppeteerCrawler({
        requestList,

        requestQueue,

        // Browser instance creation.
        launchPuppeteerFunction: () => {
            if (!input.testProxy) {
                return Apify.launchPuppeteer(input.proxyConfig || {});
            }
            return getWorkingBrowser(startUrl, input.proxyConfig);
        },

        // Main page handling function.
        handlePageFunction: async ({
            page,
            request,
            puppeteerPool
        }) => {
            console.log(`open url: ${await page.url()}`);

            /** Tells the crawler to re-enqueue current page and destroy the browser.
             *  Necessary if the page was open through a not working proxy. */
            const retireBrowser = async () => {
                // console.log('proxy invalid, re-enqueuing...');
                await puppeteerPool.retire(page.browser());
                await requestQueue.addRequest(new Apify.Request({
                    url: request.url,
                    uniqueKey: `${Math.random()}`,
                }));
            };

            // Check if startUrl was open correctly
            if (input.startUrl) {
                const pageUrl = await page.url();
                if (pageUrl.length < request.url.length) {
                    await retireBrowser();
                    return;
                }
            }
            console.log('extracting data...');
            await Apify.utils.puppeteer.injectJQuery(page);
            const result = await page.evaluate(listPageFunction, input);
            if (result.length > 0) {
                const toBeAdded = [];
                for (const item of result) {
                    if (!state.crawled[item.name]) {
                        toBeAdded.push(item);
                        state.crawled[item.name] = true;
                    }
                }
                if (migrating) {
                    await Apify.setValue('STATE', state);
                }
                if (toBeAdded.length > 0) {
                    await Apify.pushData(toBeAdded);
                }
            }


        },

        // Failed request handling
        handleFailedRequestFunction: async ({
            request
        }) => {
            await Apify.pushData({
                url: request.url,
                succeeded: false,
                errors: request.errorMessages,
            });
        },

        // Function for ignoring all unnecessary requests.
        gotoFunction: async ({
            page,
            request
        }) => {
            await page.setRequestInterception(true);

            page.on('request', async (nRequest) => {
                const url = nRequest.url();
                if (url.includes('.js')) nRequest.abort();
                // else if (url.includes('.png')) nRequest.abort();
                // else if (url.includes('.jpg')) nRequest.abort();
                // else if (url.includes('.gif')) nRequest.abort();
                else if (url.includes('.css')) nRequest.abort();
                else if (url.includes('static/fonts')) nRequest.abort();
                else if (url.includes('js_tracking')) nRequest.abort();
                else if (url.includes('facebook.com')) nRequest.abort();
                else if (url.includes('googleapis.com')) nRequest.abort();
                else if (url.includes('secure.booking.com')) nRequest.abort();
                else if (url.includes('booking.com/logo')) nRequest.abort();
                else if (url.includes('booking.com/navigation_times')) nRequest.abort();
                else {
                    // Return cached response if available
                    if (cache[url] && cache[url].expires > Date.now()) {
                        await nRequest.respond(cache[url]);
                        return;
                    }
                    nRequest.continue();
                }
            });

            // Cache responses for future needs
            page.on('response', async (response) => {
                const url = response.url();
                const headers = response.headers();
                const cacheControl = headers['cache-control'] || '';
                const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
                const maxAge = maxAgeMatch && maxAgeMatch.length > 1 ? parseInt(maxAgeMatch[1], 10) : 0;
                if (maxAge && input.cacheResponses) {
                    if (!cache[url] || cache[url].expires > Date.now()) return;

                    cache[url] = {
                        status: response.status(),
                        headers: response.headers(),
                        body: response.buffer(),
                        expires: Date.now() + (maxAge * 1000),
                    };
                }
            });

            // Hide WebDriver and randomize the request.
            await Apify.utils.puppeteer.hideWebDriver(page);
            const userAgent = Apify.utils.getRandomUserAgent();
            await page.setUserAgent(userAgent);
            const cookies = await page.cookies('https://trivago.com/en');
            await page.deleteCookie(...cookies);
            await page.viewport({
                width: 1024 + Math.floor(Math.random() * 100),
                height: 768 + Math.floor(Math.random() * 100)
            });
            return page.goto(request.url, {
                timeout: 200000
            });
        },
    });

    // Start the crawler.
    await crawler.run();
});
