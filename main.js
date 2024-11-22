/**
 * Toot-Worker
 * 
 * Author: Andre Franca
 * License: MIT or APACHE-2.0
 * Description: This Cloudflare Worker fetches the latest post from an RSS feed and publishes it to Mastodon.
 * 
 * This code runs on Cloudflare Workers. 
 * Learn more at https://developers.cloudflare.com/workers/
 */

const LAST_POST_KEY = "last_post"; // Key to track the last published post in KV storage

import { XMLParser } from "fast-xml-parser";

/**
 * Fetch RSS feed and parse all posts.
 * @param {string} rssFeedUrl - The URL of the RSS feed.
 * @returns {Array} - An array of objects containing descriptions, links, and publication dates of all posts.
 */
async function fetchAllPosts(rssFeedUrl) {
    // Validate RSS feed URL format
    if (!isValidUrl(rssFeedUrl)) {
        throw new Error(`Invalid RSS feed URL: ${rssFeedUrl}`);
    }

    try {
        // Fetch the RSS feed from the provided URL
        const response = await fetch(rssFeedUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch RSS feed: ${response.statusText}`);
        }

        // Parse the RSS feed response into text
        const rssText = await response.text();

        // Parse XML using fast-xml-parser
        const parser = new XMLParser({
            ignoreAttributes: false, // Keep attributes if necessary for later use
            attributeNamePrefix: "@_", // Optional: Prefix for attributes in parsed objects
        });
        const rssData = parser.parse(rssText);

        // Access the items in the feed (may vary depending on the RSS structure)
        const items = rssData?.rss?.channel?.item || []; // Assuming standard RSS structure

        // Map the items to an array of post objects
        return items.map((item) => {
            const descriptionHtml = item.description || "";
            const link = item.link || "";
            const pubDate = item.pubDate || "";
            const pubDateUTC = new Date(pubDate);

            // Convert HTML to plain text
            const description = convertHtmlToText(descriptionHtml);

            // Combine the plain-text description with the link to the original post
            const fullDescription = `${description}\n\nThis post was first seen on ${link}`;

            return { description: fullDescription, link, pubDateUTC };
        });
    } catch (error) {
        console.error("Error fetching or parsing RSS feed:", error);
        throw error;
    }
}

/**
 * Recursively process all eligible posts and publish them to Mastodon.
 * @param {Array} posts - Array of all posts fetched from the RSS feed.
 * @param {Object} env - The environment variables for Mastodon and KV storage.
 */
async function processPostsRecursively(posts, env) {
    const { TOOTWORKER_KV, MASTODON_INSTANCE, ACCESS_TOKEN } = env;

    // Filter posts that are within the last 30 minutes
    const nowUTC = new Date();
    const thirtyMinutesAgoUTC = new Date(nowUTC - 30 * 60 * 1000);

    for (const post of posts) { // Replace `recentPosts` with `posts`
        try {
            // Skip posts older than 30 minutes
            if (post.pubDateUTC < thirtyMinutesAgoUTC) {
                console.log(`Skipping post older than 30 minutes: ${post.link}`);
                continue;
            }
            
            // Skip posts that have already been published
            if (await isPostAlreadyPublished(post.link, TOOTWORKER_KV)) {
                console.log(`Post already published: ${post.link}`);
                continue;
            }

            // Publish the post to Mastodon
            console.log(`Publishing post: ${post.link}`);
            await publishToMastodon(post.description, MASTODON_INSTANCE, ACCESS_TOKEN);

            // Mark the post as published
            await savePublishedPost(post.link, TOOTWORKER_KV);

            console.log(`Post published and saved successfully: ${post.link}`);
        } catch (error) {
            console.error(`Error processing post: ${post.link}`, error);
        }
    }
}

/**
 * Main logic for processing the latest RSS feed.
 * Recursively processes posts published in the last 24 hours.
 * @param {Object} env - The environment variables containing RSS URL, Mastodon instance, etc.
 */
async function processLatestPosts(env) {
    const { RSS_FEED_URL } = env;

    try {
        console.log("Fetching all posts from RSS feed...");
        const posts = await fetchAllPosts(RSS_FEED_URL);

        if (!posts.length) {
            console.log("No posts available in the RSS feed.");
            return;
        }

        console.log("Processing eligible posts...");
        await processPostsRecursively(posts, env);

        console.log("All eligible posts have been processed.");
    } catch (error) {
        console.error("Error processing RSS posts:", error);
    }
}

/**
 * Validates the format of a URL.
 * @param {string} url - The URL to validate.
 * @returns {boolean} - True if the URL is valid, false otherwise.
 */
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * Converts HTML string into plain text.
 * @param {string} html - The HTML string to process.
 * @returns {string} - The plain text representation.
 */
function convertHtmlToText(html) {
    return html
        .replace(/<\/?(?:p|div|br)[^>]*>/g, "\n") // Replace block elements with newlines
        .replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)") // Convert <a> to "text (URL)"
        .replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]+)"[^>]*>/gi, "[$1] ($2)") // Convert <img> to "[alt] (URL)"
        .replace(/<[^>]+>/g, "") // Strip all other HTML tags
        .trim();
}

/**
 * Check if a post has already been published.
 * @param {string} link - The link of the current post.
 * @param {Object} kvNamespace - The KV namespace to check the last published post.
 * @returns {boolean} - True if the post has already been published, false otherwise.
 */
async function isPostAlreadyPublished(link, kvNamespace) {
    try {
        const lastPublishedLink = await kvNamespace.get(LAST_POST_KEY);
        return lastPublishedLink === link;
    } catch (error) {
        console.error("Error checking if post has already been published:", error);
        return false;
    }
}

/**
 * Save the link of the latest published post.
 * @param {string} link - The link of the latest post.
 * @param {Object} kvNamespace - The KV namespace to save the link.
 */
async function savePublishedPost(link, kvNamespace) {
    try {
        await kvNamespace.put(LAST_POST_KEY, link);
    } catch (error) {
        console.error("Error saving the published post link:", error);
    }
}

/**
 * Publish content to Mastodon.
 * @param {string} content - The content to publish.
 * @param {string} mastodonInstance - The Mastodon instance URL.
 * @param {string} accessToken - The access token for the Mastodon API.
 */
async function publishToMastodon(content, mastodonInstance, accessToken) {
    try {
        const response = await fetch(`${mastodonInstance}/api/v1/statuses`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                status: content,
                visibility: "public",
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Mastodon API Error: ${errorText}`);
        }

        console.log("Post published successfully to Mastodon.");
    } catch (error) {
        console.error("Error publishing to Mastodon:", error);
    }
}

/**
 * HTTP handler: Responds with "Working" for all HTTP requests.
 */
addEventListener("fetch", (event) => {
    event.respondWith(new Response("Working", { headers: { "Content-Type": "text/plain" } }));
});

/**
 * Scheduled handler: Triggered by Cloudflare Cron.
 * Processes the RSS feed at the scheduled interval defined in Cloudflare settings.
 */
addEventListener("scheduled", (event) => {
    event.waitUntil(
        processLatestPosts({
            RSS_FEED_URL: RSS_FEED_URL,
            MASTODON_INSTANCE: INSTANCE_URL,
            ACCESS_TOKEN: ACCESS_TOKEN,
            TOOTWORKER_KV: TOOTWORKER_KV,
        })
    );
    console.log("cron processed");
});