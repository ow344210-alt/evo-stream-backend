import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PublicFeedController } from './public-feed.controller';
import { PublicFeedService } from './public-feed.service';

describe('PublicFeedController', () => {
  let app: INestApplication;
  const emptyPage = {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 0,
  };
  const card = {
    id: 'v1',
    title: 'Amazing Man',
    description: null,
    durationSeconds: 26,
    posterUrl: null,
    publishedAt: null,
    channel: { id: 'c1', name: 'DG Test Studio', slug: 'dg-test' },
    category: null,
  };

  const mockFeed = {
    latest: jest.fn().mockResolvedValue({ ...emptyPage, items: [card], total: 1, totalPages: 1 }),
    trending: jest.fn().mockResolvedValue(emptyPage),
    search: jest.fn().mockResolvedValue(emptyPage),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PublicFeedController],
      providers: [{ provide: PublicFeedService, useValue: mockFeed }],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => jest.clearAllMocks());

  it('GET /api/feed returns latest and delegates', async () => {
    const res = await request(app.getHttpServer()).get('/api/feed').expect(200);
    expect(res.body.items[0].id).toBe('v1');
    expect(mockFeed.latest).toHaveBeenCalled();
  });

  it('GET /api/feed/latest delegates to latest', async () => {
    await request(app.getHttpServer()).get('/api/feed/latest').expect(200);
    expect(mockFeed.latest).toHaveBeenCalled();
  });

  it('GET /api/feed/trending delegates to trending', async () => {
    await request(app.getHttpServer()).get('/api/feed/trending').expect(200);
    expect(mockFeed.trending).toHaveBeenCalled();
  });

  it('GET /api/feed/search passes q and delegates to search', async () => {
    await request(app.getHttpServer()).get('/api/feed/search?q=amazing').expect(200);
    const arg: any = mockFeed.search.mock.calls[0][0];
    expect(arg.q).toBe('amazing');
  });

  it('rejects non-whitelisted query parameters', async () => {
    await request(app.getHttpServer())
      .get('/api/feed?evil=1')
      .expect(400);
  });

  it('validates pageSize bounds', async () => {
    await request(app.getHttpServer())
      .get('/api/feed?pageSize=500')
      .expect(400);
  });

  it('does not expose storage/internal fields in the payload', async () => {
    const res = await request(app.getHttpServer()).get('/api/feed').expect(200);
    const s = JSON.stringify(res.body.items[0]);
    expect(s).not.toContain('sourceStorageKey');
    expect(s).not.toContain('processError');
    expect(s).not.toContain('processingStatus');
    expect(s).not.toContain('hlsMasterKey');
  });
});
