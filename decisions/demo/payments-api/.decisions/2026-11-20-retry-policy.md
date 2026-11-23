---
title: Pick the retry policy for failed webhook deliveries
status: pending
requester: t7
created: 2026-11-20 14:10
options: ["A: Exponential backoff, 6 tries", "B: Fixed 30 s, 3 tries"]
---
## Background

Webhook deliveries fail about 2% of the time and are dropped today. Both options are built behind a flag.

## What to weigh

- **A** recovers most outages under an hour, and holds a job for up to 32 minutes.
- **B** is simpler to reason about, and gives up after 90 seconds.

I recommend A. To see the current failure rate yourself:

```sh
make report-webhooks SINCE=7d
```
