export interface PortalConfig {
  content: {
    objectTypeId: string;
    pipelineId: string;
    stageIds: {
      idea: string;
      outline: string;
      drafting: string;
      editing: string;
      review: string;
      published: string;
      archived: string;
    };
  };
  changelog: {
    objectTypeId: string;
    pipelineId: string;
    stageIds: {
      identified: string;
      drafting: string;
      reviewing: string;
      published: string;
    };
  };
  video: {
    objectTypeId: string;
    pipelineId: string;
    stageIds: {
      draft: string;
      scheduled: string;
      public: string;
    };
  };
}

const CONFIGS: Record<number, PortalConfig> = {
  // dev
  51869810: {
    content: {
      objectTypeId: '2-67505887',
      pipelineId: '926238627',
      stageIds: {
        idea: '1418659999',
        outline: '1418660000',
        drafting: '1418660001',
        editing: '1418660002',
        review: '1418660003',
        published: '1418660004',
        archived: '1418660005',
      },
    },
    changelog: {
      objectTypeId: '2-67505888',
      pipelineId: '926238628',
      stageIds: {
        identified: '1418660006',
        drafting: '1418660007',
        reviewing: '1418660008',
        published: '1418660009',
      },
    },
    video: {
      objectTypeId: '2-67505890',
      pipelineId: '926239330',
      stageIds: {
        draft: '1418680346',
        scheduled: '1418680347',
        public: '1418680348',
      },
    },
  },
  // staging
  51869787: {
    content: {
      objectTypeId: '2-67508770',
      pipelineId: '926239377',
      stageIds: {
        idea: '1418723701',
        outline: '1418723702',
        drafting: '1418723703',
        editing: '1418723704',
        review: '1418723705',
        published: '1418723706',
        archived: '1418723707',
      },
    },
    changelog: {
      objectTypeId: '2-67508772',
      pipelineId: '926366568',
      stageIds: {
        identified: '1418723403',
        drafting: '1418723404',
        reviewing: '1418723405',
        published: '1418723406',
      },
    },
    video: {
      objectTypeId: '2-67508774',
      pipelineId: '926239378',
      stageIds: {
        draft: '1418723708',
        scheduled: '1418723709',
        public: '1418723710',
      },
    },
  },
  // prod
  22047910: {
    content: {
      objectTypeId: '2-67508928',
      pipelineId: '926239383',
      stageIds: {
        idea: '1418723716',
        outline: '1418723717',
        drafting: '1418723718',
        editing: '1418723719',
        review: '1418723720',
        published: '1418723721',
        archived: '1418723722',
      },
    },
    changelog: {
      objectTypeId: '2-67508929',
      pipelineId: '926366569',
      stageIds: {
        identified: '1418723408',
        drafting: '1418723409',
        reviewing: '1418723410',
        published: '1418723411',
      },
    },
    video: {
      objectTypeId: '2-67508933',
      pipelineId: '926366570',
      stageIds: {
        draft: '1418723412',
        scheduled: '1418723413',
        public: '1418723414',
      },
    },
  },
};

export function getPortalConfig(portalId: number): PortalConfig {
  const config = CONFIGS[portalId];
  if (!config) {
    throw new Error(`No portal config found for portalId ${portalId}`);
  }
  return config;
}
