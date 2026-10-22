// Aggregates block-owned headless checks (integrator file; owners edit only their <id>.ts).
import type { BlockCheck } from './types';
import { check as check01 } from './b01-eer';
import { check as check02 } from './b02-sciences';
import { check as check03 } from './b03-gdc-speedway';
import { check as check04 } from './b04-tower';
import { check as check05 } from './b05-southmall';
import { check as check06 } from './b06-northwest';
import { check as check07 } from './b07-wcp-gregory';
import { check as check08 } from './b08-east-north';
import { check as check09 } from './b09-stadium';
import { check as check10 } from './b10-east-campus';
import { check as check11 } from './b11-south-medical';
import { check as check12 } from './b12-west-campus';
import { check as check13 } from './b13-north-perimeter';
import { check as check14 } from './b14-capitol';

export const BLOCK_CHECKS: Record<string, BlockCheck> = {
  'b01-eer': check01,
  'b02-sciences': check02,
  'b03-gdc-speedway': check03,
  'b04-tower': check04,
  'b05-southmall': check05,
  'b06-northwest': check06,
  'b07-wcp-gregory': check07,
  'b08-east-north': check08,
  'b09-stadium': check09,
  'b10-east-campus': check10,
  'b11-south-medical': check11,
  'b12-west-campus': check12,
  'b13-north-perimeter': check13,
  'b14-capitol': check14,
};
