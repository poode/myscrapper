const Apify = require('apify');

/**
 * Gets attribute as text from a ElementHandle.
 * @param {ElementHandle} element - The element to get attribute from.
 * @param {string} attr - Name of the attribute to get.
 */
const getAttribute = async (element, attr) => {
    try {
        const prop = await element.getProperty(attr);
        return (await prop.jsonValue()).trim();
    } catch (e) { return null; }
};
module.exports.getAttribute = getAttribute;

/**
 * Adds links from a page to the RequestQueue.
 * @param {Page} page - Puppeteer Page object containing the link elements.
 * @param {RequestQueue} requestQueue - RequestQueue to add the requests to.
 * @param {string} selector - A selector representing the links.
 * @param {Function} condition - Function to check if the link is to be added.
 * @param {string} label - A label for the added requests.
 * @param {Function} urlMod - Function for modifying the URL.
 * @param {Function} keyMod - Function for generating uniqueKey from the link ElementHandle.
 */
module.exports.enqueueLinks = async (page, requestQueue, selector, condition, label, urlMod, keyMod) => {
    const links = await page.$$(selector);
    for (const link of links) {
        const href = await getAttribute(link, 'href');
        if (href && (!condition || await condition(link))) {
            await requestQueue.addRequest(new Apify.Request({
                userData: { label },
                url: urlMod ? urlMod(href) : href,
                uniqueKey: keyMod ? (await keyMod(link)) : href,
            }));
        }
    }
};

/**
 * Adds URL parameters to a Booking.com URL (timespan, language and currency).
 * @param {string} url - Booking.com URL to add the parameters to.
 * @param {Object} input - The Actor input data object.
 */
module.exports.addUrlParameters = (url, input, step) => {
    if (!step) {
        step = 1
    }
    if (input.cityIds) {
        url += `?cpt2=${input.cityIds + step}%2F200`;
    }
    return url.replace('?&', '?');
};

/**
 * Finds a browser instance with working proxy for Booking.com.
 * @param {string} startUrl - Booking.com URL to test for loading.
 * @param {Object} input - The Actor input data object.
 */
module.exports.getWorkingBrowser = async (startUrl, input) => {
    const sortBy = input.sortBy || 'bayesian_review_score';
    for (let i = 0; i < 1000; i++) {
        console.log('testing proxy...');
        const browser = await Apify.launchPuppeteer(input.proxyConfig || {});
        const page = await browser.newPage();
        try{
            await Apify.utils.puppeteer.hideWebDriver(page);
            await page.goto(startUrl, { timeout: 200000 });
            await page.waitForNavigation({ timeout: 200000 });
        } catch(e) {
            console.log('invalid proxy, retrying...');
            console.log(e);
            continue;
        }
        const pageUrl = await page.url();
        if (pageUrl.indexOf(sortBy) > -1 || i === 999) {
            console.log('valid proxy found');
            await page.close();
            return browser;
        }
        console.log('invalid proxy, retrying...');
        await browser.close();
    }
};

/**
 * Creates a function to make sure the URL contains all necessary attributes from INPUT.
 * @param {string} s - The URL attribute separator (& or ;).
 */
module.exports.fixUrl = (s, input) => (href) => {
    href = href.replace(/#([a-zA-Z_]+)/g, '');
    if (input.language && href.indexOf('lang') < 0) {
        const lng = input.language.replace('_', '-');
        if (href.indexOf(s)) {
            href.replace(s, `${s}lang=${lng}${s}`);
        } else { href += `${s}lang=${lng}`; }
    }
    if (input.currency && href.indexOf('currency') < 0) {
        href += `${s}selected_currency=${input.currency.toUpperCase()}${s}changed_currency=1${s}top_currency=1`;
    }
    return href.replace(/&{n,}/g, '&').replace('?&', '?');
};

/**
 * Checks if page has some criteria filtering enabled.
 * @param {Page} page - The page to be checked.
 */
module.exports.isFiltered = (page) => page.$('.filterelement.active');
