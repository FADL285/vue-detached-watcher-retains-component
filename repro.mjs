// A watcher created inside a long-lived (detached) effect scope during a component's setup keeps that
// component instance reachable after unmount, even though the watcher itself is meant to outlive it.
// Each case mounts a child, unmounts it, forces GC and checks a WeakRef to the child instance.
//   pnpm install && pnpm repro
import { Window } from 'happy-dom';

const win = new Window();
Object.assign(globalThis, {
  window: win,
  document: win.document,
  Node: win.Node,
  Element: win.Element,
  SVGElement: win.SVGElement,
});

const { createApp, defineComponent, effectScope, getCurrentInstance, h, nextTick, ref, version, watch } =
  await import('vue');
const { createPinia, defineStore } = await import('pinia');

async function isCollected(weak) {
  for (let i = 0; i < 6; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    globalThis.gc();
  }
  return weak.deref() === undefined;
}

async function run(name, { setup, before, after, pinia } = {}) {
  let weak;
  const Child = defineComponent({
    setup() {
      weak = new WeakRef(getCurrentInstance());
      setup?.();
      return () => h('div');
    },
  });
  const show = ref(true);
  const app = createApp({ setup: () => () => (show.value ? h(Child) : h('span')) });
  if (pinia) app.use(pinia);
  before?.();
  const el = document.createElement('div');
  document.body.appendChild(el);
  app.mount(el);
  show.value = false;
  await nextTick();
  const note = after ? await after() : '';
  console.log(`${(await isCollected(weak)) ? 'collected  ' : 'RETAINED   '} ${name}${note}`);
}

console.log(`vue ${version}\n`);
const source = ref(0);

console.log('Plain Vue');
const longLived = effectScope(true);
let fired = 0;
await run('watch() inside effectScope(true).run(), called during setup', {
  setup: () =>
    longLived.run(() =>
      watch(source, () => {
        fired++;
      }),
    ),
  after: async () => {
    source.value++;
    await nextTick();
    return ` (the watcher still fires after unmount: ${fired === 1})`;
  },
});
await run('control: watch() in the component scope', { setup: () => watch(source, () => {}) });
const createdEarly = effectScope(true);
await run('control: the same detached watcher created before mount', {
  before: () => createdEarly.run(() => watch(source, () => {})),
});
const stoppedLater = effectScope(true);
await run('control: the detached scope is stopped after unmount', {
  setup: () => stoppedLater.run(() => watch(source, () => {})),
  after: async () => {
    stoppedLater.stop();
    return '';
  },
});

console.log('\nPinia');
const useCounter = defineStore('counter', () => {
  const count = ref(0);
  watch(count, () => {});
  return { count };
});
await run('setup store with one watch(), first used in the child', { pinia: createPinia(), setup: () => useCounter() });
const usePlain = defineStore('plain', () => ({ count: ref(0) }));
const withSubscribePlugin = createPinia();
// pinia-plugin-persistedstate does this for every persisted store.
withSubscribePlugin.use(({ store }) => {
  store.$subscribe(() => {}, { detached: true });
});
await run('store without watchers + a plugin calling $subscribe({ detached: true })', {
  pinia: withSubscribePlugin,
  setup: () => usePlain(),
});
await run('control: store without watchers or plugins', { pinia: createPinia(), setup: () => usePlain() });
