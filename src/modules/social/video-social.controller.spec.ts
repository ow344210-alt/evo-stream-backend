import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { PassportModule, PassportStrategy, AuthModuleOptions } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { ExtractJwt, Strategy as JwtStrategyBase } from 'passport-jwt';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { VideoSocialController } from './video-social.controller';
import { ChannelSocialController } from './channel-social.controller';
import { MeSocialController } from './me-social.controller';
import { LikesService } from './likes.service';
import { CommentsService } from './comments.service';
import { FollowsService } from './follows.service';
import { SavedVideosService } from './saved-videos.service';
import { WatchHistoryService } from './watch-history.service';
import { VideoSharesService } from './video-shares.service';
import { SocialSummaryService } from './social-summary.service';

const SECRET = 'test-secret';
const CURRENT_USER_ID = 'u1';

class TestJwtStrategy extends PassportStrategy(JwtStrategyBase) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: true,
      secretOrKey: SECRET,
    });
  }
  async validate(payload: { sub: string }) {
    return {
      id: payload.sub,
      email: `${payload.sub}@example.com`,
      role: UserRole.USER,
      name: 'Test User',
      status: 'ACTIVE',
    };
  }
}

describe('Social controllers (E2E guard boundary + wiring)', () => {
  let app: INestApplication;

  const likes = {
    like: jest.fn(),
    unlike: jest.fn(),
    getLikedVideos: jest.fn(),
  };
  const comments = {
    create: jest.fn(),
    list: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const follows = {
    follow: jest.fn(),
    unfollow: jest.fn(),
    getFollowing: jest.fn(),
  };
  const saved = { save: jest.fn(), unsave: jest.fn(), getSavedVideos: jest.fn() };
  const history = {
    recordProgress: jest.fn(),
    getHistory: jest.fn(),
    removeHistoryItem: jest.fn(),
  };
  const shares = { share: jest.fn() };
  const summary = { getSummary: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    likes.like.mockResolvedValue({ liked: true, likeCount: 1 });
    comments.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    summary.getSummary.mockResolvedValue({ likeCount: 1, commentCount: 0, shareCount: 0 });
    shares.share.mockResolvedValue({ shared: true, shareCount: 1 });

    const moduleFixture = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [
        VideoSocialController,
        ChannelSocialController,
        MeSocialController,
      ],
      providers: [
        { provide: AuthModuleOptions, useValue: {} },
        TestJwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: LikesService, useValue: likes },
        { provide: CommentsService, useValue: comments },
        { provide: FollowsService, useValue: follows },
        { provide: SavedVideosService, useValue: saved },
        { provide: WatchHistoryService, useValue: history },
        { provide: VideoSharesService, useValue: shares },
        { provide: SocialSummaryService, useValue: summary },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const VIDEO = '123e4567-e89b-12d3-a456-426614174000';
  const authToken = jwt.sign({ sub: CURRENT_USER_ID }, SECRET);

  it('rejects an unauthenticated like with 401', async () => {
    await request(app.getHttpServer())
      .post(`/api/videos/${VIDEO}/like`)
      .expect(401);
    expect(likes.like).not.toHaveBeenCalled();
  });

  it('accepts an authenticated like and passes the id from the request only', async () => {
    // Attempt to smuggle a different user id in the body: it must be ignored.
    await request(app.getHttpServer())
      .post(`/api/videos/${VIDEO}/like`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ userId: 'evil-user' })
      .expect(201);

    expect(likes.like).toHaveBeenCalledWith(CURRENT_USER_ID, VIDEO);
  });

  it('returns 201 for an authenticated comment and never trusts body userId', async () => {
    comments.create.mockResolvedValue({ id: 'cm1' });

    await request(app.getHttpServer())
      .post(`/api/videos/${VIDEO}/comments`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ content: 'Hello', userId: 'evil-user' })
      .expect(201);

    expect(comments.create).toHaveBeenCalledWith(
      CURRENT_USER_ID,
      VIDEO,
      expect.objectContaining({ content: 'Hello' }),
    );
  });

  it('allows publicly listing comments without a token', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/videos/${VIDEO}/comments`)
      .expect(200);
    expect(res.body.items).toBeDefined();
  });

  it('allows publicly fetching the social summary without a token', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/videos/${VIDEO}/social-summary`)
      .expect(200);
    expect(res.body.likeCount).toBe(1);
    expect(summary.getSummary).toHaveBeenCalledWith(VIDEO, undefined);
  });

  it('populates the optional user on the summary when a token is provided', async () => {
    await request(app.getHttpServer())
      .get(`/api/videos/${VIDEO}/social-summary`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(summary.getSummary).toHaveBeenCalledWith(VIDEO, CURRENT_USER_ID);
  });

  it('returns 401 for unauthenticated save, follow, progress, share', async () => {
    await request(app.getHttpServer()).post(`/api/videos/${VIDEO}/save`).expect(401);
    await request(app.getHttpServer()).post(`/api/videos/${VIDEO}/progress`).expect(401);
    await request(app.getHttpServer()).post(`/api/videos/${VIDEO}/share`).expect(401);
    await request(app.getHttpServer())
      .post('/api/channels/11111111-1111-4111-8111-111111111111/follow')
      .expect(401);
  });

  it('requires a token for /me collections', async () => {
    await request(app.getHttpServer()).get('/api/me/likes').expect(401);
    await request(app.getHttpServer()).get('/api/me/history').expect(401);
    await request(app.getHttpServer()).get('/api/me/saved').expect(401);
    await request(app.getHttpServer()).get('/api/me/following').expect(401);
  });

  it('records a share under the authenticated user id', async () => {
    await request(app.getHttpServer())
      .post(`/api/videos/${VIDEO}/share`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    expect(shares.share).toHaveBeenCalledWith(CURRENT_USER_ID, VIDEO);
  });
});
