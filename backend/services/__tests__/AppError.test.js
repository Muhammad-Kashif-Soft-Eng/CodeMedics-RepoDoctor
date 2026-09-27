'use strict';

const AppError = require('../AppError');

describe('AppError', () => {
  test('is an instance of Error', () => {
    const err = new AppError('SOME_CODE', 400, 'Something went wrong');
    expect(err).toBeInstanceOf(Error);
  });

  test('is an instance of AppError', () => {
    const err = new AppError('SOME_CODE', 400, 'Something went wrong');
    expect(err).toBeInstanceOf(AppError);
  });

  test('sets name to "AppError"', () => {
    const err = new AppError('SOME_CODE', 400, 'msg');
    expect(err.name).toBe('AppError');
  });

  test('stores code', () => {
    const err = new AppError('INVALID_URL', 400, 'msg');
    expect(err.code).toBe('INVALID_URL');
  });

  test('stores httpStatus', () => {
    const err = new AppError('INVALID_URL', 422, 'msg');
    expect(err.httpStatus).toBe(422);
  });

  test('stores message', () => {
    const err = new AppError('MISSING_URL', 400, 'A URL is required.');
    expect(err.message).toBe('A URL is required.');
  });

  test('has a stack trace', () => {
    const err = new AppError('MISSING_URL', 400, 'msg');
    expect(typeof err.stack).toBe('string');
    expect(err.stack.length).toBeGreaterThan(0);
  });

  test('different instances are independent', () => {
    const a = new AppError('MISSING_URL', 400, 'first');
    const b = new AppError('INVALID_URL', 422, 'second');
    expect(a.code).not.toBe(b.code);
    expect(a.httpStatus).not.toBe(b.httpStatus);
    expect(a.message).not.toBe(b.message);
  });
});
