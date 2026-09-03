import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinatesFromMapsUrl } from './transportation.js';

test('extracts coordinates from a Google Maps route URL', () => {
  assert.deepEqual(
    coordinatesFromMapsUrl('https://www.google.com/maps/@30.0444196,31.2357116,14z'),
    { latitude: 30.0444196, longitude: 31.2357116 },
  );
});

test('extracts encoded place coordinates from a shared Google Maps URL', () => {
  assert.deepEqual(
    coordinatesFromMapsUrl('https://www.google.com/maps/place/Cairo/data=!3d30.04442!4d31.23571'),
    { latitude: 30.04442, longitude: 31.23571 },
  );
});

test('rejects invalid coordinates', () => {
  assert.equal(coordinatesFromMapsUrl('https://www.google.com/maps?q=200,400'), null);
});
