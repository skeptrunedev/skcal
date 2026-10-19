import React from 'react';
import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';
import { Text, Pressable } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import * as SecureStore from 'expo-secure-store';
import App from '../App';
import { ThemeProvider, useTheme } from '../src/theme';
import { getToken, setToken, photoSource } from '../src/api';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
// Keep the real provider: no native inset event is delivered in these tests.
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  initialWindowMetrics: {
    frame: { x: 0, y: 0, width: 400, height: 800 },
    insets: { top: 24, bottom: 24, left: 0, right: 0 },
  },
}));
jest.mock('../src/SignIn', () => {
  const { Text } = require('react-native');
  return { SignIn: () => <Text>Sign in</Text> };
});
jest.mock('../src/Today', () => {
  const { Text } = require('react-native');
  return { Today: () => <Text>Today content</Text> };
});
jest.mock('../src/Body', () => ({ Body: () => null }));
jest.mock('../src/Agent', () => ({ Agent: () => null }));
jest.mock('../src/Drawer', () => ({ Drawer: () => null }));
jest.mock('../src/Paywall', () => ({ Paywall: () => null }));
jest.mock('../src/icons', () => ({ PanelLeftIcon: () => null }));
jest.mock('../src/iap', () => ({
  reconcilePendingTransactions: async () => false,
  watchTransactions: () => () => {},
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let tree: ReactTestRenderer | undefined;
const read = jest.mocked(SecureStore.getItemAsync);
const text = () => JSON.stringify(tree?.toJSON());
async function mount(element: React.ReactElement) {
  await act(async () => { tree = create(element); });
}

beforeEach(() => {
  jest.useFakeTimers();
  read.mockReset().mockResolvedValue(null);
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ email: 'test@example.com' }) } as Response);
  jest.mocked(SecureStore.deleteItemAsync).mockClear();
});
afterEach(async () => {
  if (tree) await act(async () => { tree!.unmount(); });
  tree = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('cold launch renders sign-in without waiting for a native inset event', async () => {
  await mount(<App />);
  expect(text()).toContain('Sign in');
});

test('a stalled preference read never hides the app', async () => {
  read.mockImplementation((key) => key === 'skcal_theme' ? new Promise(() => {}) : Promise.resolve(null));
  await mount(<App />);
  expect(text()).toContain('Sign in');
});

test('a stalled session read shows progress, then retry, and recovers without clearing storage', async () => {
  read.mockImplementation((key) => key === 'skcal_session_token' ? new Promise(() => {}) : Promise.resolve(null));
  await mount(<App />);
  expect(text()).toContain('Opening skcal');
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(text()).toContain('Try again');
  expect(text()).not.toContain('Sign in');
  read.mockResolvedValue('saved-session');
  await act(async () => {
    tree!.root.findByProps({ accessibilityLabel: 'Try opening skcal again' }).props.onPress();
  });
  expect(text()).toContain('Today content');
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});

test('storage rejection gives retry rather than silently signing the user out', async () => {
  read.mockImplementation((key) => key === 'skcal_session_token' ? Promise.reject(new Error('locked')) : Promise.resolve(null));
  await mount(<App />);
  expect(text()).toContain('Try again');
  expect(text()).not.toContain('Sign in');
});

test('a late stored theme cannot override a new user choice', async () => {
  const pref = deferred<string | null>();
  read.mockReturnValue(pref.promise);
  function Probe() {
    const { pref, setPref } = useTheme();
    return <Pressable accessibilityLabel="Choose light" onPress={() => setPref('light')}><Text>{pref}</Text></Pressable>;
  }
  await mount(<ThemeProvider><Probe /></ThemeProvider>);
  expect(text()).toContain('dark');
  await act(async () => { tree!.root.findByProps({ accessibilityLabel: 'Choose light' }).props.onPress(); });
  await act(async () => { pref.resolve('dark'); });
  expect(text()).toContain('light');
});

test('a timed-out token read cannot overwrite the token from a successful retry', async () => {
  const old = deferred<string | null>();
  read.mockReturnValueOnce(old.promise).mockResolvedValueOnce('current-session');
  const failedRead = getToken().catch(() => 'timed out');
  jest.advanceTimersByTime(5000);
  expect(await failedRead).toBe('timed out');
  expect(await getToken()).toBe('current-session');
  old.resolve('old-session');
  await Promise.resolve();
  expect(photoSource('/api/agent/photos/test').headers?.authorization).toBe('Bearer current-session');
});

test('an in-flight token read cannot undo sign-out', async () => {
  const old = deferred<string | null>();
  read.mockReturnValueOnce(old.promise);
  const pending = getToken();
  await setToken(null);
  old.resolve('old-session');
  expect(await pending).toBeNull();
  expect(photoSource('/api/agent/photos/test').headers?.authorization).toBeUndefined();
});
