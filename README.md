# Poolchain

Poolchain is a black-and-white Solana donation-pool interface prototype. It is a static frontend and can be deployed to Vercel without a build step.

## Deploy to Vercel

1. Import the `okabri/pactfund` GitHub repository in Vercel.
2. Keep the project root at the repository root.
3. Select the Other framework preset, leave the build command empty, and use `.` as the output directory if Vercel asks for one.
4. Deploy. Vercel serves `index.html` as the home page.

## Local preview

Open `index.html` in a browser, or run a static file server from this directory:

```sh
python -m http.server 4173
```

Then visit `http://localhost:4173`.

## Prototype limitations

- Pool and application records are stored in the browser; evidence files stay in that browser's IndexedDB.
- Phantom and Solflare connection uses an injected wallet provider when available.
- Pool creation, applicant selection, escrow, and payouts are demonstrations. There is no deployed Solana program, server, or real transfer in this prototype.

A production version needs a reviewed and deployed Solana program, persistent shared storage, authenticated wallet sessions, and secure evidence-file storage.

