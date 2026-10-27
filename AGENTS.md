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

## Emlékeztető: Regisztráció Visszaállítása (Értékesítés / Nyitás Indulásakor)
A regisztráció jelenleg ideiglenesen le van zárva a `public/auth.html` fájlban, amíg az értékesítés el nem indul:
- A `<form id="register-form">` elemen belül egy `#register-coming-soon` blokk jeleníti meg a **„Hamarosan nyitunk!”** feliratot.
- Az eredeti regisztrációs űrlap mezői érintetlenül a `#register-form-fields` (`style="display: none;"`) konténerben vannak elrejtve.
- A `handleRegister(e)` függvény elején van egy korai visszatérés (`return`), ha a `#register-coming-soon` látható.
- **Visszaállítás lépései nyitáskor:** a `public/auth.html`-ben a `#register-coming-soon` blokkot el kell távolítani (vagy `display: none`-ra állítani), a `#register-form-fields`-ről pedig le kell venni a `style="display: none;"`-t.
