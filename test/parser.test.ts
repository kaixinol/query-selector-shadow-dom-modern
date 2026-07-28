import { describe, it, expect } from 'vitest';
import { splitByComma, tokenizePath } from '../src/index';

describe('splitByComma', () => {
  it('splits simple comma-separated selectors', () => {
    expect(splitByComma('div, span')).toEqual(['div', 'span']);
  });

  it('splits multiple selectors', () => {
    expect(splitByComma('div, span, a.cls')).toEqual(['div', 'span', 'a.cls']);
  });

  it('ignores commas inside attribute values (double quotes)', () => {
    expect(splitByComma('[data-value="a,b"]')).toEqual(['[data-value="a,b"]']);
  });

  it('ignores commas inside attribute values (single quotes)', () => {
    expect(splitByComma("[data-value='a,b']")).toEqual(["[data-value='a,b']"]);
  });

  it('ignores commas inside pseudo-class parens', () => {
    expect(splitByComma(':not(.a,.b)')).toEqual([':not(.a,.b)']);
  });

  it('handles mixed commas inside and outside parens', () => {
    expect(splitByComma('div, :is(a, b)')).toEqual(['div', ':is(a, b)']);
  });

  it('handles nested parens', () => {
    expect(splitByComma(':is(a, :is(b, c))')).toEqual([':is(a, :is(b, c))']);
  });

  it('handles commas inside brackets within quotes', () => {
    expect(splitByComma('a[title="he,llo"], span')).toEqual(['a[title="he,llo"]', 'span']);
  });

  it('handles multiple attribute selectors with brackets', () => {
    expect(splitByComma('input[type="text"][disabled], a[href]')).toEqual([
      'input[type="text"][disabled]',
      'a[href]',
    ]);
  });

  it('ignores commas inside :where() with quotes', () => {
    expect(splitByComma(':where(a[href*="?"])')).toEqual([':where(a[href*="?"])']);
  });

  it('trims whitespace from parts', () => {
    expect(splitByComma('  div  ,  span  ')).toEqual(['div', 'span']);
  });

  it('returns empty array for empty string', () => {
    expect(splitByComma('')).toEqual([]);
  });

  it('handles single selector without comma', () => {
    expect(splitByComma('div')).toEqual(['div']);
  });

  it('handles complex attribute with special chars in value', () => {
    expect(splitByComma('[href^="https://example.com/path?q=1&r=2"]')).toEqual([
      '[href^="https://example.com/path?q=1&r=2"]',
    ]);
  });

  it('handles escaped quotes', () => {
    expect(splitByComma('button[data-test="it\\"s"]')).toEqual(['button[data-test="it\\"s"]']);
  });
});

describe('tokenizePath', () => {
  it('tokenizes a simple tag selector', () => {
    expect(tokenizePath('div')).toEqual(['div']);
  });

  it('tokenizes descendant combinator', () => {
    expect(tokenizePath('div span')).toEqual(['div', ' ', 'span']);
  });

  it('tokenizes child combinator', () => {
    expect(tokenizePath('div > span')).toEqual(['div', '>', 'span']);
  });

  it('tokenizes adjacent sibling combinator', () => {
    expect(tokenizePath('div + span')).toEqual(['div', '+', 'span']);
  });

  it('tokenizes general sibling combinator', () => {
    expect(tokenizePath('div ~ span')).toEqual(['div', '~', 'span']);
  });

  it('tokenizes a chain of combinators', () => {
    expect(tokenizePath('div > p + span ~ a')).toEqual(['div', '>', 'p', '+', 'span', '~', 'a']);
  });

  it('handles combinators without spaces around them', () => {
    expect(tokenizePath('div>p')).toEqual(['div', '>', 'p']);
  });

  it('handles multiple spaces as single descendant combinator', () => {
    expect(tokenizePath('div    span')).toEqual(['div', ' ', 'span']);
  });

  it('handles spaces around combinators', () => {
    expect(tokenizePath('div  >  span')).toEqual(['div', '>', 'span']);
  });

  it('ignores > inside attribute values with quotes', () => {
    expect(tokenizePath('[data-path="a > b"]')).toEqual(['[data-path="a > b"]']);
  });

  it('ignores combinators inside pseudo-class parens', () => {
    expect(tokenizePath(':is(div > span)')).toEqual([':is(div > span)']);
  });

  it('ignores + inside attribute values with quotes', () => {
    expect(tokenizePath('[title="foo + bar"]')).toEqual(['[title="foo + bar"]']);
  });

  it('tokenizes universal selector', () => {
    expect(tokenizePath('*')).toEqual(['*']);
  });

  it('tokenizes universal selector with descendant', () => {
    expect(tokenizePath('div * span')).toEqual(['div', ' ', '*', ' ', 'span']);
  });

  it('tokenizes class selector', () => {
    expect(tokenizePath('.cls')).toEqual(['.cls']);
  });

  it('tokenizes id selector', () => {
    expect(tokenizePath('#id')).toEqual(['#id']);
  });

  it('tokenizes mixed tag with class and id', () => {
    expect(tokenizePath('div.my-class#my-id')).toEqual(['div.my-class#my-id']);
  });

  it('tokenizes attribute selector', () => {
    expect(tokenizePath('input[type="text"]')).toEqual(['input[type="text"]']);
  });

  it('tokenizes multiple attribute selectors', () => {
    expect(tokenizePath('input[type="text"][disabled]')).toEqual([
      'input[type="text"][disabled]',
    ]);
  });

  it('tokenizes pseudo-class without arguments', () => {
    expect(tokenizePath('div:first-child')).toEqual(['div:first-child']);
  });

  it('tokenizes pseudo-class with arguments', () => {
    expect(tokenizePath(':nth-child(2n+1)')).toEqual([':nth-child(2n+1)']);
  });

  it('tokenizes pseudo-element', () => {
    expect(tokenizePath('div::before')).toEqual(['div::before']);
  });

  it('tokenizes :not() pseudo-class', () => {
    expect(tokenizePath('div:not(.cls)')).toEqual(['div:not(.cls)']);
  });

  it('tokenizes :is() with multiple selectors', () => {
    expect(tokenizePath(':is(div, span)')).toEqual([':is(div, span)']);
  });

  it('tokenizes :where() with attribute selector containing special chars', () => {
    expect(tokenizePath(':where(a[href*="?"])')).toEqual([':where(a[href*="?"])']);
  });

  it('returns empty array for empty string', () => {
    expect(tokenizePath('')).toEqual([]);
  });

  it('handles leading whitespace', () => {
    expect(tokenizePath('  div')).toEqual(['div']);
  });

  it('handles trailing whitespace', () => {
    expect(tokenizePath('div  ')).toEqual(['div']);
  });

  it('handles combinators inside :host-context()', () => {
    expect(tokenizePath(':host-context(body) div')).toEqual([':host-context(body)', ' ', 'div']);
  });

  it('handles ::part() pseudo-element', () => {
    expect(tokenizePath('div::part(button)')).toEqual(['div::part(button)']);
  });

  it('handles escaped quote inside attribute single quotes', () => {
    expect(tokenizePath("button[data-test='it\\'s']")).toEqual([
      "button[data-test='it\\'s']",
    ]);
  });

  it('handles brackets inside attribute values', () => {
    expect(tokenizePath('[data-value="[nested]"]')).toEqual(['[data-value="[nested]"]']);
  });

  it('handles parens inside attribute values', () => {
    expect(tokenizePath('[data-value="(nested)"]')).toEqual(['[data-value="(nested)"]']);
  });
});