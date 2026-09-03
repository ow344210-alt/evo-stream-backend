import { Module } from '@nestjs/common';
import { PoliciesService } from './policies.service';
import { AdminPoliciesController } from './admin-policies.controller';
import { PublicPoliciesController } from './public-policies.controller';

@Module({
  controllers: [AdminPoliciesController, PublicPoliciesController],
  providers: [PoliciesService],
  exports: [PoliciesService],
})
export class PoliciesModule {}
