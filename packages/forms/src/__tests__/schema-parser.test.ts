import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createFormSchemaParser,
  field,
  parseSchema,
  SchemaParser,
  withFormMeta,
} from '../schema-parser.js';

describe('parseSchema', () => {
  it('should parse a simple object schema into form config', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      active: z.boolean(),
    });
    const config = parseSchema(schema);
    expect(config.fields.length).toBe(3);
    expect(config.fields[0]?.name).toBe('name');
    expect(config.fields[0]?.type).toBe('text');
    expect(config.fields[1]?.name).toBe('age');
    expect(config.fields[1]?.type).toBe('number');
    expect(config.fields[2]?.name).toBe('active');
    expect(config.fields[2]?.type).toBe('checkbox');
  });

  it('should infer email type from string().email()', () => {
    const schema = z.object({
      contact: z.string().email(),
    });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('email');
  });

  it('should infer select type from z.enum()', () => {
    const schema = z.object({
      color: z.enum(['red', 'green', 'blue']),
    });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('select');
    expect(config.fields[0]?.options?.length).toBe(3);
    expect(config.fields[0]?.options?.[0]?.value).toBe('red');
  });

  it('should infer date type from z.date()', () => {
    const schema = z.object({
      birthday: z.date(),
    });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('date');
  });

  it('should infer array and object types', () => {
    const schema = z.object({
      tags: z.array(z.string()),
      address: z.object({ street: z.string(), city: z.string() }),
    });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('array');
    expect(config.fields[1]?.type).toBe('object');
  });

  it('should mark optional fields as not required', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
      nullable: z.string().nullable(),
    });
    const config = parseSchema(schema);
    expect(config.fields[0]?.required).toBe(true);
    expect(config.fields[1]?.required).toBe(false);
    expect(config.fields[2]?.required).toBe(false);
  });

  it('should extract string constraints (min, max, regex)', () => {
    const schema = z.object({
      username: z
        .string()
        .min(3)
        .max(20)
        .regex(/^[a-z]+$/),
    });
    const config = parseSchema(schema);
    const field = config.fields[0];
    expect(field?.minLength).toBe(3);
    expect(field?.maxLength).toBe(20);
    expect(field?.pattern).toBe('^[a-z]+$');
  });

  it('should extract number constraints (min, max)', () => {
    const schema = z.object({
      age: z.number().min(0).max(150),
    });
    const config = parseSchema(schema);
    const field = config.fields[0];
    expect(field?.min).toBe(0);
    expect(field?.max).toBe(150);
  });

  it('should extract default values', () => {
    const schema = z.object({
      role: z.string().default('user'),
    });
    const config = parseSchema(schema);
    expect(config.fields[0]?.defaultValue).toBe('user');
  });

  it('should skip fields starting with underscore', () => {
    const schema = z.object({
      name: z.string(),
      _internal: z.string(),
    });
    const config = parseSchema(schema);
    expect(config.fields.length).toBe(1);
    expect(config.fields[0]?.name).toBe('name');
  });

  it('should pass through title, description, and submitText options', () => {
    const schema = z.object({ name: z.string() });
    const config = parseSchema(schema, {
      title: 'User Form',
      description: 'Create a new user',
      submitText: 'Save',
    });
    expect(config.title).toBe('User Form');
    expect(config.description).toBe('Create a new user');
    expect(config.submitText).toBe('Save');
  });

  it('should auto-detect groups from field metadata', () => {
    const schema = z.object({
      name: withFormMeta(z.string(), { group: 'personal' }),
      email: withFormMeta(z.string().email(), { group: 'personal' }),
      company: withFormMeta(z.string(), { group: 'work' }),
    });
    const config = parseSchema(schema);
    expect(config.groups?.length).toBe(2);
    expect(config.groups?.[0]?.id).toBe('personal');
    expect(config.groups?.[0]?.fields).toEqual(['name', 'email']);
    expect(config.groups?.[1]?.id).toBe('work');
  });

  it('should handle union types as select', () => {
    const schema = z.object({
      status: z.union([z.literal('active'), z.literal('inactive'), z.literal('pending')]),
    });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('select');
    expect(config.fields[0]?.options?.length).toBe(3);
  });

  it('should parse nested object fields', () => {
    const schema = z.object({
      address: z.object({
        street: z.string(),
        city: z.string(),
      }),
    });
    const config = parseSchema(schema);
    const addressField = config.fields[0];
    expect(addressField?.type).toBe('object');
    expect(addressField?.fields?.length).toBe(2);
    expect(addressField?.fields?.[0]?.name).toBe('street');
  });
});

describe('withFormMeta', () => {
  it('should attach metadata to a schema', () => {
    const schema = withFormMeta(z.string(), {
      label: 'Full Name',
      placeholder: 'Enter name',
      helpText: 'Your full legal name',
    });
    const config = parseSchema(z.object({ name: schema }));
    expect(config.fields[0]?.label).toBe('Full Name');
    expect(config.fields[0]?.placeholder).toBe('Enter name');
    expect(config.fields[0]?.helpText).toBe('Your full legal name');
  });

  it('should override inferred field type', () => {
    const schema = withFormMeta(z.string(), { fieldType: 'textarea' });
    const config = parseSchema(z.object({ bio: schema }));
    expect(config.fields[0]?.type).toBe('textarea');
  });

  it('should set display order', () => {
    const schema = z.object({
      b: withFormMeta(z.string(), { order: 2 }),
      a: withFormMeta(z.string(), { order: 1 }),
    });
    const config = parseSchema(schema);
    expect(config.fields[0]?.name).toBe('a');
    expect(config.fields[1]?.name).toBe('b');
  });
});

describe('field helpers', () => {
  it('should create text field', () => {
    const schema = z.object({ name: field.text({ label: 'Name' }) });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('text');
    expect(config.fields[0]?.label).toBe('Name');
  });

  it('should create email field', () => {
    const schema = z.object({ email: field.email() });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('email');
  });

  it('should create password field', () => {
    const schema = z.object({ pass: field.password() });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('password');
  });

  it('should create number field', () => {
    const schema = z.object({ count: field.number() });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('number');
  });

  it('should create date field', () => {
    const schema = z.object({ dob: field.date() });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('date');
  });

  it('should create textarea field', () => {
    const schema = z.object({ bio: field.textarea() });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('textarea');
  });

  it('should create checkbox field', () => {
    const schema = z.object({ agree: field.checkbox() });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('checkbox');
  });

  it('should create toggle field', () => {
    const schema = z.object({ notifications: field.toggle() });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('toggle');
  });

  it('should create select field with options', () => {
    const schema = z.object({ role: field.select(['admin', 'user', 'guest']) });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('select');
    expect(config.fields[0]?.options?.length).toBe(3);
  });

  it('should create radio field', () => {
    const schema = z.object({ size: field.radio(['small', 'medium', 'large']) });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('radio');
  });

  it('should create hidden field', () => {
    const schema = z.object({ id: field.hidden() });
    const config = parseSchema(schema);
    expect(config.fields[0]?.hidden).toBe(true);
  });

  it('should create relation field', () => {
    const schema = z.object({
      author: field.relation('users', 'name'),
    });
    const config = parseSchema(schema);
    expect(config.fields[0]?.type).toBe('relation');
    expect(config.fields[0]?.relation?.collection).toBe('users');
    expect(config.fields[0]?.relation?.displayField).toBe('name');
  });
});

describe('SchemaParser class', () => {
  let parser: SchemaParser;

  it('should create via factory', () => {
    parser = createFormSchemaParser();
    expect(parser).toBeInstanceOf(SchemaParser);
  });

  it('should parse schema same as standalone function', () => {
    parser = createFormSchemaParser();
    const schema = z.object({ name: z.string() });
    const config = parser.parse(schema, { title: 'Test' });
    expect(config.title).toBe('Test');
    expect(config.fields.length).toBe(1);
  });

  it('should validate data against schema — success', () => {
    parser = createFormSchemaParser();
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = parser.validate(schema, { name: 'Alice', age: 30 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: 'Alice', age: 30 });
  });

  it('should validate data against schema — failure with field errors', () => {
    parser = createFormSchemaParser();
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = parser.validate(schema, { name: 123, age: 'not a number' });
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.name).toBeDefined();
    expect(result.errors?.age).toBeDefined();
  });

  it('should extract default values from schema', () => {
    parser = createFormSchemaParser();
    const schema = z.object({
      name: z.string().default('John'),
      role: z.string().default('user'),
      age: z.number(),
    });
    const defaults = parser.getDefaults(schema);
    expect(defaults.name).toBe('John');
    expect(defaults.role).toBe('user');
    expect(defaults.age).toBeUndefined();
  });
});

describe('label formatting', () => {
  it('should format camelCase field names as labels', () => {
    const schema = z.object({
      firstName: z.string(),
      lastName: z.string(),
    });
    const config = parseSchema(schema);
    expect(config.fields[0]?.label).toBe('First Name');
    expect(config.fields[1]?.label).toBe('Last Name');
  });

  it('should format snake_case field names as labels', () => {
    const schema = z.object({
      first_name: z.string(),
    });
    const config = parseSchema(schema);
    expect(config.fields[0]?.label).toBe('First Name');
  });
});
