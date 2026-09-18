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

test('prefers the place marker over the viewport center', () => {
  assert.deepEqual(
    coordinatesFromMapsUrl('https://www.google.com/maps/place/Test/@30.1205292,31.3156357,17z/data=!3d30.1205292!4d31.3182106'),
    { latitude: 30.1205292, longitude: 31.3182106 },
  );
});

test('rejects invalid coordinates', () => {
  assert.equal(coordinatesFromMapsUrl('https://www.google.com/maps?q=200,400'), null);
});
