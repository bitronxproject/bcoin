/*!
 * pk-browser.js - public key algorithms for bcoin
 * Copyright (c) 2016-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

/**
 * @module crypto/pk-browser
 * @ignore
 */

var assert = require('assert');
var elliptic = require('elliptic');
var BN = require('./bn');
var ASN1 = require('../utils/asn1');
var backend = require('./backend');
var rsa, ecdsa;

/**
 * RSA
 * @namespace module:crypto/pk-browser.rsa
 * @ignore
 */

rsa = {};

/**
 * PKCS signature prefixes.
 * @type {Object}
 * @memberof module:crypto/pk-browser.rsa
 */

rsa.prefixes = {
  md5: Buffer.from('3020300c06082a864886f70d020505000410', 'hex'),
  sha1: Buffer.from('3021300906052b0e03021a05000414', 'hex'),
  sha224: Buffer.from('302d300d06096086480165030402040500041c', 'hex'),
  sha256: Buffer.from('3031300d060960864801650304020105000420', 'hex'),
  sha384: Buffer.from('3041300d060960864801650304020205000430', 'hex'),
  sha512: Buffer.from('3051300d060960864801650304020305000440', 'hex'),
  ripemd160: Buffer.from('30203008060628cf060300310414', 'hex')
};

/**
 * Verify RSA signature.
 * @memberof module:crypto/pk-browser.rsa
 * @param {String} alg - Hash algorithm.
 * @param {Buffer} msg - Signed message.
 * @param {Buffer} sig - Signature.
 * @param {Buffer} key - ASN1 serialized RSA key.
 * @returns {Boolean}
 */

rsa.verify = function verify(alg, msg, sig, key) {
  var prefix = rsa.prefixes[alg];
  var hash, len, pub;
  var N, e, k, m, em, ok, i;

  if (!prefix)
    throw new Error('Unknown PKCS prefix.');

  hash = backend.hash(alg, msg);
  len = prefix.length + hash.length;
  pub = ASN1.parseRSAPublic(key);

  N = new BN(pub.modulus);
  e = new BN(pub.publicExponent);
  k = Math.ceil(N.bitLength() / 8);

  if (k < len + 11)
    throw new Error('Message too long.');

  m = rsa.encrypt(N, e, sig);
  em = leftpad(m, k);

  ok = ceq(em[0], 0x00);
  ok &= ceq(em[1], 0x01);
  ok &= backend.ccmp(em.slice(k - hash.length, k), hash);
  ok &= backend.ccmp(em.slice(k - len, k - hash.length), prefix);
  ok &= ceq(em[k - len - 1], 0x00);

  for (i = 2; i < k - len - 1; i++)
    ok &= ceq(em[i], 0xff);

  return ok === 1;
};

/**
 * Sign message with RSA key.
 * @memberof module:crypto/pk-browser.rsa
 * @param {String} alg - Hash algorithm.
 * @param {Buffer} msg - Signed message.
 * @param {Buffer} key - ASN1 serialized RSA key.
 * @returns {Buffer} Signature (DER)
 */

rsa.sign = function sign(alg, msg, key) {
  var prefix = rsa.prefixes[alg];
  var hash, len, priv;
  var N, D, k, i, em;

  if (!prefix)
    throw new Error('Unknown PKCS prefix.');

  hash = backend.hash(alg, msg);
  len = prefix.length + hash.length;
  priv = ASN1.parseRSAPrivate(key);

  N = new BN(priv.modulus);
  D = new BN(priv.privateExponent);
  k = Math.ceil(N.bitLength() / 8);

  if (k < len + 11)
    throw new Error('Message too long.');

  em = Buffer.allocUnsafe(k);
  em.fill(0);

  em[1] = 0x01;
  for (i = 2; i < k - len - 1; i++)
    em[i] = 0xff;

  prefix.copy(em, k - len);
  hash.copy(em, k - hash.length);

  return rsa.decrypt(N, D, em);
};

/**
 * Decrypt with modulus and exponent.
 * @memberof module:crypto/pk-browser.rsa
 * @param {BN} N
 * @param {BN} D
 * @param {Buffer} m
 * @returns {Buffer}
 */

rsa.decrypt = function decrypt(N, D, m) {
  var c = new BN(m);

  if (c.cmp(N) > 0)
    throw new Error('Cannot decrypt.');

  return c
    .toRed(BN.red(N))
    .redPow(D)
    .fromRed()
    .toArrayLike(Buffer, 'be');
};

/**
 * Encrypt with modulus and exponent.
 * @memberof module:crypto/pk-browser.rsa
 * @param {BN} N
 * @param {BN} e
 * @param {Buffer} m
 * @returns {Buffer}
 */

rsa.encrypt = function encrypt(N, e, m) {
  return new BN(m)
    .toRed(BN.red(N))
    .redPow(e)
    .fromRed()
    .toArrayLike(Buffer, 'be');
};

/**
 * ECDSA
 * @namespace module:crypto/pk.ecdsa
 * @ignore
 */

ecdsa = {};

/**
 * Verify ECDSA signature.
 * @memberof module:crypto/pk-browser.ecdsa
 * @param {String} curve - Curve name.
 * @param {String} alg - Hash algorithm.
 * @param {Buffer} msg - Signed message.
 * @param {Buffer} sig - Signature.
 * @param {Buffer} key - ASN1 serialized ECDSA key.
 * @returns {Boolean}
 */

ecdsa.verify = function verify(curve, alg, msg, sig, key) {
  var ec, hash;

  assert(curve, 'No curve selected.');

  ec = elliptic.ec(curve);
  hash = backend.hash(alg, msg);

  return ec.verify(hash, sig, key);
};

/**
 * Sign message with ECDSA key.
 * @memberof module:crypto/pk-browser.ecdsa
 * @param {String} curve - Curve name.
 * @param {String} alg - Hash algorithm.
 * @param {Buffer} msg - Signed message.
 * @param {Buffer} key - ASN1 serialized ECDSA key.
 * @returns {Buffer} Signature (DER)
 */

ecdsa.sign = function sign(curve, alg, msg, key) {
  var ec, hash;

  assert(curve, 'No curve selected.');

  ec = elliptic.ec(curve);
  hash = backend.hash(alg, msg);

  return Buffer.from(ec.sign(hash, key));
};

/*
 * Helpers
 */

function leftpad(input, size) {
  var n = input.length;
  var out;

  if (n > size)
    n = size;

  out = Buffer.allocUnsafe(size);
  out.fill(0);

  input.copy(out, out.length - n);

  return out;
}

function ceq(a, b) {
  var r = ~(a ^ b) & 0xff;
  r &= r >>> 4;
  r &= r >>> 2;
  r &= r >>> 1;
  return r === 1;
}

/*
 * Expose
 */

exports.rsa = rsa;
exports.ecdsa = ecdsa;
