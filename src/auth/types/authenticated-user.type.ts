import { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  name: string;
  status: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}
