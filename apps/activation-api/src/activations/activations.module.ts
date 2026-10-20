import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Activation, ActivationSchema } from './activations.schema';
import { ActivationsService } from './activations.service';
import { ActivationsController } from './activations.controller';
import { KafkaModule } from './kafka/kafka.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Activation.name, schema: ActivationSchema },
    ]),
    KafkaModule,
  ],
  controllers: [ActivationsController],
  providers: [ActivationsService],
})
export class ActivationsModule {}
