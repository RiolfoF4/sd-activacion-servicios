import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { toActivationSnapshot } from './activations.snapshot';
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

  // Devuelve exactamente el mismo snapshot que emite el WebSocket, así la UI
  // trabaja con una sola forma y el GET sigue siendo la fuente de verdad
  // (estado inicial y recuperación después de una reconexión).
  @Get(':id')
  async findById(@Param('id') id: string) {
    const activation = await this.activationsService.findById(id);
    if (!activation) throw new NotFoundException(`Activation ${id} not found`);
    return toActivationSnapshot(activation);
  }
}
