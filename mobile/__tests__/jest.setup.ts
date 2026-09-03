import "@testing-library/react-native";

// Mocks expo routing/navigation (currently in package-lock.json but not used)
jest.mock('expo-router', () => ({
    useRouter: () => ({ push: jest.fn() }),
}));

// Mocks file system behaviour (currently in package-lock.json but not used)
jest.mock('expo-file-system', () => ({
    readAsStringAsync: jest.fn(async () => 'mock file content'),
    writeAsStringAsync: jest.fn(async () => { }),
    deleteAsync: jest.fn(async () => { }),
    getInfoAsync: jest.fn(async () => ({
        exists: true,
        isDirectory: false,
        uri: 'mock://file',
        size: 1234,
    })),
    makeDirectoryAsync: jest.fn(async () => { }),
    copyAsync: jest.fn(async () => { }),
    moveAsync: jest.fn(async () => { }),
}));