import { Controller, Get } from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class PublicCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @Public()
  list() {
    return this.categories.findActive();
  }
}
