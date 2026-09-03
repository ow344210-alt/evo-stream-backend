import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PoliciesService } from './policies.service';
import { CreatePolicyDto } from './dto/create-policy.dto';
import { UpdatePolicyDto } from './dto/update-policy.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@Controller('admin/policies')
@Roles(UserRole.ADMIN)
export class AdminPoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.policies.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.policies.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePolicyDto) {
    return this.policies.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePolicyDto) {
    return this.policies.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.policies.remove(id);
  }
}
