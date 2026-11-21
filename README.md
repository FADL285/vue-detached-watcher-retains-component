# A watcher in a long-lived effect scope keeps the component that created it alive

Minimal reproduction for Vue 3.5.44, with no framework other than Pinia.

A child component's setup creates a `watch` inside a scope that lives longer than the child, such as an `effectScope(true)` or a Pinia store. After the child unmounts, the watcher keeps working, as intended. The child instance, though, stays reachable for as long as that scope lives.

`doWatch` keeps `currentInstance` in the watcher's `call` closure (`callWithAsyncErrorHandling(fn, instance, …)`), and in `job.i` for `pre`/`post` flush. It does this whatever scope the watcher was created in.

## Run

```sh
pnpm install
pnpm repro   # NODE_ENV=production node --expose-gc repro.mjs
```

Each case mounts a child, unmounts it, forces GC, and checks a `WeakRef` to the child instance (happy-dom, Vue production build).

## Result

```
Plain Vue
RETAINED    watch() inside effectScope(true).run(), called during setup (the watcher still fires after unmount: true)
collected   control: watch() in the component scope
collected   control: the same detached watcher created before mount
collected   control: the detached scope is stopped after unmount

Pinia
RETAINED    setup store with one watch(), first used in the child
RETAINED    store without watchers + a plugin calling $subscribe({ detached: true })
collected   control: store without watchers or plugins
```

The Pinia cases are the common way to hit this. A setup store runs inside its own long-lived scope, so when the first `useStore()` call happens in a component's setup, every watcher the store creates keeps that component alive for the life of the app. That includes the `$subscribe(…, { detached: true })` that pinia-plugin-persistedstate adds to every persisted store.
