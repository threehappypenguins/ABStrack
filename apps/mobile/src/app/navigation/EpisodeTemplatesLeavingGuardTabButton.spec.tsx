import * as React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  useNavigationState,
  type NavigationState,
} from '@react-navigation/native';

import {
  EpisodeTemplatesDraftProvider,
  useEpisodeTemplatesDraftRegistration,
} from './EpisodeTemplatesDraftContext';
import { EpisodeTemplatesLeavingGuardTabButton } from './EpisodeTemplatesLeavingGuardTabButton';
import type { MainTabParamList } from './types';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigationState: jest.fn(),
  };
});

jest.mock('@abstrack/ui/native', () => {
  const actual = jest.requireActual('@abstrack/ui/native');
  return {
    ...actual,
    announce: jest.fn(),
  };
});

function makeEpisodeTemplatesNavState(
  nested: 'EpisodeTemplateCreate' | 'EpisodeTemplateEdit',
): NavigationState {
  const nestedScreen =
    nested === 'EpisodeTemplateEdit'
      ? ({
          key: 'EpisodeTemplateEdit',
          name: 'EpisodeTemplateEdit' as const,
          params: { templateId: 't1' },
        } as const)
      : ({
          key: 'EpisodeTemplateCreate',
          name: 'EpisodeTemplateCreate' as const,
        } as const);

  const nestedStack: NavigationState = {
    key: 'episode-templates-stack',
    index: 0,
    routeNames: [nestedScreen.name],
    type: 'stack',
    stale: false,
    routes: [nestedScreen],
  };

  return {
    key: 'main-tabs',
    index: 0,
    routeNames: ['EpisodeTemplates'],
    type: 'tab',
    stale: false,
    routes: [
      {
        key: 'EpisodeTemplates',
        name: 'EpisodeTemplates',
        state: nestedStack,
      },
    ],
  };
}

function TabButtonWithDraft(props: {
  isDirty: boolean;
  busy: boolean;
  targetRoute: keyof MainTabParamList;
  onTabPress: () => void;
  navigateToList: () => void;
}) {
  useEpisodeTemplatesDraftRegistration(
    true,
    props.isDirty,
    props.busy,
    props.navigateToList,
  );
  return (
    <EpisodeTemplatesLeavingGuardTabButton
      targetRoute={props.targetRoute}
      onPress={props.onTabPress}
      testID="leaving-guard-tab"
    >
      {null}
    </EpisodeTemplatesLeavingGuardTabButton>
  );
}

describe('EpisodeTemplatesLeavingGuardTabButton', () => {
  const navigateToList = jest.fn();
  const onTabPress = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(useNavigationState)
      .mockImplementation((selector) =>
        selector(makeEpisodeTemplatesNavState('EpisodeTemplateCreate')),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('when draft is dirty and user switches to another tab, shows discard alert; navigateToList and tab onPress run only after confirm', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    const screen = render(
      <EpisodeTemplatesDraftProvider>
        <TabButtonWithDraft
          isDirty
          busy={false}
          targetRoute="Home"
          onTabPress={onTabPress}
          navigateToList={navigateToList}
        />
      </EpisodeTemplatesDraftProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('leaving-guard-tab'));
    });

    expect(navigateToList).not.toHaveBeenCalled();
    expect(onTabPress).not.toHaveBeenCalled();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Discard unsaved changes?');
    expect(message).toContain('not saved');

    const discard = buttons?.find((b) => b.text === 'Discard changes');
    expect(discard?.onPress).toEqual(expect.any(Function));

    await act(async () => {
      discard?.onPress?.();
    });

    expect(navigateToList).toHaveBeenCalledTimes(1);
    expect(onTabPress).toHaveBeenCalledTimes(1);
  });

  test('same behavior when nested route is EpisodeTemplateEdit', async () => {
    jest
      .mocked(useNavigationState)
      .mockImplementation((selector) =>
        selector(makeEpisodeTemplatesNavState('EpisodeTemplateEdit')),
      );

    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    const screen = render(
      <EpisodeTemplatesDraftProvider>
        <TabButtonWithDraft
          isDirty
          busy={false}
          targetRoute="SymptomPresets"
          onTabPress={onTabPress}
          navigateToList={navigateToList}
        />
      </EpisodeTemplatesDraftProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('leaving-guard-tab'));
    });

    expect(navigateToList).not.toHaveBeenCalled();
    expect(onTabPress).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);

    const [, , buttons] = alertSpy.mock.calls[0];
    await act(async () => {
      buttons?.find((b) => b.text === 'Discard changes')?.onPress?.();
    });

    expect(navigateToList).toHaveBeenCalledTimes(1);
    expect(onTabPress).toHaveBeenCalledTimes(1);
  });

  test('when draft is not dirty, switches tab without alert and resets stack via navigateToList', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    const screen = render(
      <EpisodeTemplatesDraftProvider>
        <TabButtonWithDraft
          isDirty={false}
          busy={false}
          targetRoute="Home"
          onTabPress={onTabPress}
          navigateToList={navigateToList}
        />
      </EpisodeTemplatesDraftProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('leaving-guard-tab'));
    });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(navigateToList).toHaveBeenCalledTimes(1);
    expect(onTabPress).toHaveBeenCalledTimes(1);
  });
});
