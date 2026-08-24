# ⚡ Axis v4 — The Fastest Proxy Browser

Axis v4 is a cutting-edge web proxy built on **Scramjet** with a built-in **redemption system** for speed boosts. Browse freely, block ads, and unlock 10× performance with a redeem code.

## 🚀 Features

- **Blazing fast** — Optimized WebSocket pooling and caching
- **Ad blocking** — Built-in filter for 50+ ad networks
- **Redeem system** — Enter a code to unlock 10× speed
- **Auto-failover** — Switches servers if one goes down
- **Modern UI** — Dark theme with glass-morphism
- **Tabbed browsing** — Multiple tabs with navigation controls
- **12-hour clock** + full date in footer

## 🔑 Redeem Codes (for testing)

| Code | Effect |
|------|--------|
| `SPEED-2024` | Unlocks 10× speed |
| `AXIS-BOOST` | Unlocks 10× speed |
| `TURBO-10X` | Unlocks 10× speed |
| `VIP-PROXY` | Unlocks 10× speed |
| `ULTRA-FAST` | Unlocks 10× speed |

## 🛠️ Deployment

### Docker
```bash
docker build -t axis-v4 .
docker run -p 8080:80 axis-v4
