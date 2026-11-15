import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiResponse } from '../utils/ApiResponse';
import { User } from '../models/User';
import { ApiError } from '../utils/ApiError';
import { env } from '../config/env';

const isCrossSite = Boolean(env.CORS_ORIGIN && !env.CORS_ORIGIN.includes('localhost'));
const useSecureCookie = env.NODE_ENV === 'production' || isCrossSite;
const refreshCookieOptions = {
  httpOnly: true,
  secure: useSecureCookie,
  sameSite: useSecureCookie ? ('none' as const) : ('lax' as const),
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const { user, accessToken, refreshToken } = await AuthService.login(email, password);

  // Set HTTP-only cookie for refresh token
  res.cookie('refreshToken', refreshToken, refreshCookieOptions);

  return ApiResponse.success(res, 'Login successful', {
    user,
    accessToken,
  });
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
  if (!refreshToken) {
    throw ApiError.unauthorized('Refresh token missing');
  }

  const tokens = await AuthService.refresh(refreshToken);

  res.cookie('refreshToken', tokens.refreshToken, refreshCookieOptions);

  return ApiResponse.success(res, 'Token refreshed successfully', {
    accessToken: tokens.accessToken,
  });
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  if (req.user) {
    await AuthService.logout(req.user.id);
  }
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: refreshCookieOptions.secure,
    sameSite: refreshCookieOptions.sameSite,
    path: refreshCookieOptions.path,
  });
  return ApiResponse.success(res, 'Logged out successfully');
});

export const getMeHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user?.id);
  if (!user) {
    throw ApiError.notFound('User not found');
  }
  return ApiResponse.success(res, 'User profile retrieved', user);
});
