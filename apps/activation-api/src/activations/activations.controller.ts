import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { CreateActivationDto } from './dto/create-activation.dto';
import { ActivationsService } from './activations.service';

@Controller('activations')
export class ActivationsController {
  constructor(private readonly activationsService: ActivationsService) {}

  @Post()
  @HttpCode(202)
  async create(@Body() createActivationDto: CreateActivationDto) {
    const { _id: activationId, status } =
      await this.activationsService.create(createActivationDto);
    return { activationId, status };
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    const activation = await this.activationsService.findById(id);
    if (!activation) throw new NotFoundException(`Activation ${id} not found`);
    return activation;
  }
}
