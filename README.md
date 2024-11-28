# Toot-Worker

**Toot-Worker** is a serverless application that automatically posts new articles from your RSS feed to your Mastodon account. It runs on Cloudflare Workers.


### Step 1. Deploy this project to Cloudflare Workers

Sign up with Cloudflare, and click the button below to start deploying.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/a-franca/toot-worker)

Alternatively, you can clone the project and run [`wrangler deploy`](https://developers.cloudflare.com/workers/wrangler/commands/#deploy) locally.

### Step 2. Configure a KV (key-value data storage) for your worker

* Expand to the Works & Pages page on the Cloudflare dashboard, then select KV.

* Create a new namespace, and give it a name.

* Update your project's wrangler.toml file with your KV id.

```toml
kv_namespaces = [
  { binding = "TOOTWORKER_KV", id = "add your id here" }
]
```

### Step 3. Configure Environment Variables

Go back to the toot-worker service page on the Cloudflare dashboard, select Settings > Variables, and add the following Environment Variables to your worker:

* Type Text
    * RSS_FEED_URL: https://your.feed.rss
    * MASTODON_INSTANCE: https://your.mastodon.instance.com
* Type Secret
    * ACCESS_TOKEN: Create an access token in the Development section of your mastodon account. The **only** scope necessary is `write:statuses`, then add it here.
* Bindings
    * TOOTWORKER_KV as variable. For Value, select the KV you've just created.

### Step 4. Set up cron

* Select Settings > Trigger Events

* Select Cron Trigger

* Set up using a cron expression, e.g. */30 * * * * (checks your rss feed every 30 minuts). See [Crontab Guru](https://crontab.guru/#*/30_*_*_*_*).

### [Optional] Step 5. Enable workers log

* Go to Settings > Observability

* Make sure to enable Workers Logs


## License

This project is distributed under the terms of both the MIT license and the Apache License (Version 2.0). See [LICENSE-MIT](https://github.com/a-franca/toot-worker/blob/main/LICENSE-MIT) and [LICENSE-APACHE](https://github.com/a-franca/toot-worker/blob/main/LICENSE-APACHE) for details.