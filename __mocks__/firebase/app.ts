// Minimal mock of firebase/app - avoids pulling in the real @firebase/app
// internals, which use ESM syntax Jest isn't configured to transform.

let apps: any[] = [];

export const initializeApp = (options: any) => {
    const app = { name: '[DEFAULT]', options };
    apps.push(app);
    return app;
};

export const getApps = () => apps;

export const getApp = () => apps[0];

// Reset between tests
export const __resetAppMock = () => {
    apps = [];
};
