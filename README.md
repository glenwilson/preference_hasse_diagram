# Crowd Song Preference Order

A real-time crowd-sourced song preference tool that displays a Hasse diagram.

## How it works

Visitors are shown two songs and choose the one they prefer.

Each pair has shared vote totals. The app determines the current majority result
for each pair, then builds a valid directed acyclic graph:

1. Stronger majority relations are considered first.
2. A relationship is excluded if it would create a preference cycle.
3. Transitive relationships are removed.
4. The remaining direct relationships are shown as a Hasse diagram.

Higher nodes represent more preferred songs.

## Firebase setup

1. Create a project at <https://console.firebase.google.com/>.
2. Add a **Web App** to the Firebase project.
3. Enable **Authentication**:
   - Go to Authentication → Sign-in method.
   - Enable **Anonymous** authentication.
4. Create a **Realtime Database**:
   - Go to Realtime Database.
   - Create a database.
5. Add your Firebase configuration object to `app.js`.
6. Open Realtime Database → Rules.
7. Publish the contents of `firebase-rules.json`.
8. In Firebase Authentication → Settings → Authorized domains, add:
   - `localhost`
   - `<your-github-username>.github.io`

## Local development

You can run it with any static web server.

For example:

```bash
python3 -m http.server 8000
