import { StyleSheet } from 'react-native';

export default StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: '#fff5eb',
  },
  pageScreen: {
    flex: 1,
    paddingTop: 40,
    paddingHorizontal: 24,
  },
  pageTitle: {
    fontSize: 38,
    fontWeight: '800',
    color: '#c74c14',
    marginBottom: 12,
  },
  pageSubtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: '#7d4a2d',
  },
  pageCard: {
    flex: 1,
    borderRadius: 28,
    backgroundColor: '#fff0e3',
    padding: 24,
    shadowColor: '#c36a49',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderColor: '#ffd7bf',
    backgroundColor: '#ffe7d4',
  },
  navButton: {
    flex: 1,
    marginHorizontal: 4,
    borderRadius: 18,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonActive: {
    backgroundColor: '#ffb17d',
  },
  navButtonInactive: {
    backgroundColor: 'transparent',
  },
  navButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8a3b1b',
  },
  navButtonTextActive: {
    color: '#fff',
  },
});