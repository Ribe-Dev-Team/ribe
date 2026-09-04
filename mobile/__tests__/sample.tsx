// sample test copied from https://testing-library.com/docs/react-native-testing-library/example-intro/
// note: 'Example' function would normally be located in a different file to the test code

import * as React from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

function Example() {
  const [name, setUser] = React.useState('');
  const [show, setShow] = React.useState(false);

  return (
    <View>
      <TextInput value={name} onChangeText={setUser} testID="input" />
      <Button
        title="Print Username"
        onPress={() => {
          // let's pretend this is making a server request, so it's async
          // (you'd want to mock this imaginary request in your unit tests)...
          setTimeout(() => {
            setShow(true);
          }, Math.floor(Math.random() * 200));
        }}
      />
      {show && <Text testID="printed-username">{name}</Text>}
    </View>
  );
}

test('examples of some things', async () => {
  const expectedUsername = 'Ada Lovelace';

  // construct page in testing environment
  render(<Example />);

  // perform actions related to the thing being tested (in this case, changing the username)
  fireEvent.changeText(screen.getByTestId('input'), expectedUsername);
  fireEvent.press(screen.getByText('Print Username'));

  // Using `findBy` query to wait for asynchronous operation to finish
  const usernameOutput = await screen.findByTestId('printed-username');

  // Using the built-in `toHaveTextContent` matcher from React Native Testing Library.
  expect(usernameOutput).toHaveTextContent(expectedUsername);

  // .toMatchSnapshot() will compare the rendered code against a previous version to check for consistency
  // if there are intentional changes, you will need to update the snapshot using `jest --updateSnapshot`
  expect(screen.toJSON()).toMatchSnapshot();
});