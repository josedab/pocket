import { describe, it, expect, beforeEach } from 'vitest';
import { FederationGenerator, createFederationGenerator } from '../federation.js';
import type { FederationConfig } from '../federation.js';

const testConfig: FederationConfig = {
  serviceName: 'pocket-service',
  serviceUrl: 'http://localhost:4001/graphql',
  entities: [
    {
      collection: 'users',
      typeName: 'User',
      fields: { name: 'string', email: 'string', age: 'number' },
      keyFields: ['id'],
    },
    {
      collection: 'posts',
      typeName: 'Post',
      fields: { title: 'string', body: 'string', authorId: 'string' },
      keyFields: ['id'],
      externalFields: ['authorId'],
    },
  ],
};

describe('FederationGenerator', () => {
  let generator: FederationGenerator;

  beforeEach(() => {
    generator = createFederationGenerator(testConfig);
  });

  describe('generateSDL', () => {
    it('should include federation v2 link directive', () => {
      const sdl = generator.generateSDL();
      expect(sdl).toContain('extend schema @link');
      expect(sdl).toContain('federation/v2.0');
    });

    it('should generate entity types with @key directive', () => {
      const sdl = generator.generateSDL();
      expect(sdl).toContain('type User @key(fields: "id")');
      expect(sdl).toContain('type Post @key(fields: "id")');
    });

    it('should include ID field for key fields', () => {
      const sdl = generator.generateSDL();
      expect(sdl).toContain('id: ID!');
    });

    it('should map field types correctly', () => {
      const sdl = generator.generateSDL();
      expect(sdl).toContain('name: String');
      expect(sdl).toContain('age: Float');
    });

    it('should mark external fields', () => {
      const sdl = generator.generateSDL();
      expect(sdl).toContain('authorId: String @external');
    });

    it('should generate Query type', () => {
      const sdl = generator.generateSDL();
      expect(sdl).toContain('type Query');
      expect(sdl).toContain('users(id: ID!): User');
      expect(sdl).toContain('usersList(limit: Int, offset: Int): [User!]!');
    });

    it('should generate Mutation type', () => {
      const sdl = generator.generateSDL();
      expect(sdl).toContain('type Mutation');
      expect(sdl).toContain('createUser(');
      expect(sdl).toContain('updateUser(id: ID!');
      expect(sdl).toContain('deleteUser(id: ID!): Boolean!');
    });
  });

  describe('generateSubgraph', () => {
    it('should return complete subgraph info', () => {
      const subgraph = generator.generateSubgraph();
      expect(subgraph.serviceName).toBe('pocket-service');
      expect(subgraph.serviceUrl).toBe('http://localhost:4001/graphql');
      expect(subgraph.entities).toEqual(['User', 'Post']);
      expect(subgraph.sdl.length).toBeGreaterThan(0);
    });
  });

  describe('generateReferenceResolvers', () => {
    it('should create resolvers for each entity', () => {
      const resolvers = generator.generateReferenceResolvers();
      expect(resolvers).toHaveLength(2);
      expect(resolvers[0]?.typeName).toBe('User');
      expect(resolvers[0]?.keyFields).toEqual(['id']);
    });

    it('should resolve representations', () => {
      const resolvers = generator.generateReferenceResolvers();
      const userResolver = resolvers.find((r) => r.typeName === 'User');
      const result = userResolver?.resolve({ id: '123', __typename: 'User' });
      expect(result).toBeDefined();
      expect((result as Record<string, unknown>)?.['__typename']).toBe('User');
    });
  });

  describe('generateSupergraphConfig', () => {
    it('should include this subgraph', () => {
      const config = generator.generateSupergraphConfig();
      expect(config.subgraphs).toHaveLength(1);
      expect(config.subgraphs[0]?.name).toBe('pocket-service');
    });

    it('should include additional subgraphs', () => {
      const config = generator.generateSupergraphConfig([
        { name: 'auth', url: 'http://localhost:4002/graphql', sdl: 'type Query { me: User }' },
      ]);
      expect(config.subgraphs).toHaveLength(2);
    });
  });

  describe('shareable directive', () => {
    it('should add @shareable when configured', () => {
      const shareableGen = createFederationGenerator({
        ...testConfig,
        shareable: true,
      });
      const sdl = shareableGen.generateSDL();
      expect(sdl).toContain('@shareable');
    });
  });

  describe('federation v1', () => {
    it('should not include link directive for v1', () => {
      const v1Gen = createFederationGenerator({
        ...testConfig,
        version: '1.0',
      });
      const sdl = v1Gen.generateSDL();
      expect(sdl).not.toContain('extend schema @link');
    });
  });
});
