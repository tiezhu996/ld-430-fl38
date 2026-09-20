import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DOWNLOAD_ROUTES } from '../routes/download.routes';
import { DownloadService } from '../services/download.service';
import { DownloadPurpose } from '../types/enums';
import type { AuthUser } from '../types/interfaces';
import { ok } from '../utils/response';

@ApiTags('downloads')
@Controller()
export class DownloadController {
  constructor(private readonly downloadService: DownloadService) {}

  @Get(DOWNLOAD_ROUTES.root)
  async findAll() {
    return ok(await this.downloadService.findAll());
  }

  @Post(DOWNLOAD_ROUTES.byAsset)
  async create(@Param('assetId') assetId: string, @Req() req: Request & { user?: AuthUser }, @Body('purpose') purpose: DownloadPurpose = DownloadPurpose.Personal) {
    return ok(await this.downloadService.create(assetId, req.user ?? { id: 'anonymous', role: undefined as never }, purpose), '下载已记录');
  }

  @Post(DOWNLOAD_ROUTES.redeem)
  async redeem(
    @Param('assetId') assetId: string,
    @Req() req: Request & { user?: AuthUser },
    @Body('code') code: string,
    @Body('purpose') purpose: DownloadPurpose = DownloadPurpose.Commercial,
  ) {
    const user = req.user ?? { id: 'anonymous', role: undefined as never };
    return ok(await this.downloadService.redeemWithLicense(assetId, user, code, purpose), '许可下载已记录');
  }
}
