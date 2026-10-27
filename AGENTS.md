# HawkStone Webpage – Fejlesztői és Git Szabályok (Antigravity Rules)

## Két különálló Git Remote (Kötelező Mindkettőre Pusholni!)
A projektnek **2 különálló távoli Git tárolója (remote)** van, amelyeknek szinkronban kell lenniük:
1. **`origin`**: `https://github.com/rekalaca/wallclimber.git` (fő fejlesztői tároló)
2. **`client`**: `https://github.com/wrekalaca-prog/hawkstone-web.git` (**ez a tároló van bekötve a Vercel éles élesítéshez / deploymenthez!**)

### Minden commit után MINDIG mindkét remote-ra le kell futtatni a push parancsot:
```bash
git push origin main
git push client main
```

Ha a `client` remote-ra elmarad a push, a Vercel nem fogja látni a legfrissebb módosításokat és nem indul el az éles frissítés!
