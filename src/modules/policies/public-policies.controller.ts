import { Controller, Get } from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { PoliciesService } from './policies.service';

@Controller('policies')
export class PublicPoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get()
  @Public()
  list() {
    return this.policies.findActive();
  }
}
