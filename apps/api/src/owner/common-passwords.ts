/**
 * Passwords of 8 or more characters that appear near the top of public breach lists. Shorter ones
 * are already refused by the length rule. Compared in lower case.
 */
const LIST = `
12345678 123456789 1234567890 12345678910 123123123 123321123 11111111 111111111 1111111111
00000000 000000000 0000000000 88888888 87654321 987654321 9876543210 11223344 12341234
1q2w3e4r 1q2w3e4r5t 1q2w3e4r5t6y 1qaz2wsx 1qazxsw2 zaq12wsx zaq1zaq1 qwertyui qwertyuiop
qwerty123 qwerty1234 qwerty12345 asdfghjk asdfghjkl zxcvbnm1 zxcvbnm123 password password1
password12 password123 password1234 passw0rd p@ssw0rd p@ssword pa$$word passpass iloveyou
iloveyou1 iloveyou2 princess1 sunshine1 football1 baseball1 superman batman123 starwars
trustno1 whatever letmein1 welcome1 welcome123 admin123 admin1234 administrator changeme
abcd1234 abc12345 abcdefgh abcdefg1 a1b2c3d4 aa123456 aaaaaaaa qqqqqqqq q1w2e3r4 qazwsxedc
monkey123 dragon123 master123 michael1 jennifer jordan23 computer internet blink182 football
baseball sunshine princess charlie1 michelle nicholas jessica1 liverpool chelsea1 arsenal1
manchester mustang1 corvette mercedes ferrari1 yamaha123 samsung1 samsung123 google123
facebook instagram whatsapp restrovia restrovia1 restrovia123 cafe1234 coffee123 restaurant
india123 india@123 bharat123 krishna1 krishna123 ganesh123 jaishreeram jaimatadi omsairam
saibaba1 hanuman1 lakshmi1 mumbai123 delhi123 kolkata1 chennai1 bangalore hyderabad pakistan
cricket1 cricket123 sachin10 dhoni007 kohli18 hello123 hello1234 helloworld lovely123
loveyou1 sweetheart 12qwaszx 147258369 159753456 159357456 741852963 789456123 123654789
123456789a a123456789 123456abc 1234qwer 1234abcd qwer1234 asdf1234 zxcv1234 test1234
testtest guest123 user1234 default1 secret123 mypassword newpassword
`;

export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(LIST.split(/\s+/).filter(Boolean));
