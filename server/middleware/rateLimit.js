// Very simple in-memory rate limiter (per IP)
// Not for production scale, but helps basic brute-force mitigation without extra deps
export default function rateLimit({ windowMs = 15 * 60 * 1000, max = 100 } = {}) {
  const hits = new Map(); // ip -> { count, first }

  function cleanup(now) {
    for (const [ip, rec] of hits) {
      if (now - rec.first > windowMs) hits.delete(ip);
    }
  }

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const now = Date.now();
    const rec = hits.get(ip) || { count: 0, first: now };

    if (now - rec.first > windowMs) {
      rec.count = 0;
      rec.first = now;
    }

    rec.count += 1;
    hits.set(ip, rec);
    cleanup(now);

    if (rec.count > max) {
      res.status(429).json({ message: "Too many requests, try again later" });
      return;
    }
    next();
  };
}

