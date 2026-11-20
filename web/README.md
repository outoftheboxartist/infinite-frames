# Infinite Frames (web)

The shareable Infinite Frames app: Vercel hosting, Supabase sign-in, live drawing.

- **Canvas:** the Foveated Zoom engine (`src/engine.js`), nested canvases every 8x zoom,
  sharp near your finger with prism sparkles at the edges.
- **Sign-in:** Google through Supabase Auth (`src/supabase.js`). Until Google is switched on in
  the Supabase project, the button says so and people draw as a guest.
- **Live:** strokes appear on everyone's screen as they are drawn, with names next to
  pointers (`src/live.js`, Supabase Realtime broadcast and presence). Strokes are not saved yet;
  saving comes with `../supabase/migrations/`.

```
npm install
npm run dev      # local
npm run build    # dist/
```

Supabase project and key default to the existing Infinite Frames project; override with
`VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`.

## Switching on Google sign-in

1. Google Cloud console → APIs & Services → Credentials → Create OAuth client ID → Web application.
   Authorized redirect URI: `https://xqfevafhjbdulhcqcmao.supabase.co/auth/v1/callback`
2. Supabase dashboard → Authentication → Sign In / Providers → Google: turn on, paste the
   Client ID and Client secret, save.
3. Supabase dashboard → Authentication → URL Configuration: add the Vercel address
   (for example `https://infinite-frames-web.vercel.app`) to Redirect URLs, and set it as Site URL.
